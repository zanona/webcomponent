function importComponent(name) {
  document.imported = document.imported || {};
  if (document.imported[name]) { return; }
  document.imported[name] = 'pending';
  var link = document.createElement('link');
  link.rel = 'import';
  link.async = true;
  link.href = name + '.html';
  document.head.appendChild(link);
  link.addEventListener('load', () => {
    const doc      = link.import,
          template = doc.querySelector('template'),
          exported = doc.exports;
    if (template && exported) { exported.attachTemplate(template); }
    document.imported[name] = exported;
    document.registerElement(name, exported);
  });
  return this;
}

Object.defineProperty(window, 'module', {
  get() {
    const script = document._currentScript || document.currentScript,
          doc = script ? script.ownerDocument : document;
    doc.import = importComponent;
    return doc;
  }
});

class CoreWebComponent extends HTMLElement {
  static attachTemplate(template) {
    this.template = template.content;
  }
  _linkTemplate() {
    const shadowRoot = this.createShadowRoot(),
          template = document.importNode(this.constructor.template, true);
    shadowRoot.appendChild(template);
  }
  createdCallback() {
    // RELYING ON DOCUMENT.IMPORTED SINCE THE POLYFILL MESSES UP WITH
    // CONSTRUCTOR OBJECTS
    if (!this.constructor.name) {
      this.constructor = document.imported[this.nodeName.toLowerCase()];
    }
    if (this.constructor.template) { this._linkTemplate(); }
    if (this.created) this.created();
  }
  attachedCallback() {
    this._analyse();
    if (this.attached) this.attached();
  }
}

class WebComponent extends CoreWebComponent {
  _searchBindings(text) {
    const tag = /([\[\{]){2}([a-z-\.\_$]+)[\]\}]{2}/gi,
          bindings = [];
    text.replace(tag, (raw, type, key) => {
      bindings.push({
        auto: type === '{',
        key,
        raw
      });
    });
    return bindings;
  }
  _bind(node, binding) {
    let from, fromKey, to, toKey;

    if (node._ownerElement === this) {
      from     = node._ownerElement;
      fromKey  = node.nodeName;
      to       = node._ownerInstance.parentNode.host;
      toKey    = binding.key;
    } else {
      from     = node._ownerInstance;
      fromKey  = binding.key;
      to       = node._ownerElement;
      toKey    = node.nodeName;
      binding.auto = true;
    }
    /*
    console.log(node._ownerElement);
    console.log(
      'CHANGES ON ' +
      `${from.nodeName}.${fromKey} ` +
      `${binding.auto ? 'WILL' : 'WILL NOT'} UPDATE ` +
      `${to.nodeName}.${toKey}`
    );
    */

    const propertyBindings = from._bindings[fromKey] = from._bindings[fromKey] || [];
    propertyBindings.push({
      raw: binding.raw,
      key: toKey,
      host: from,
      related: to,
      node: node,
      originalValue: node.textContent
    });
  }
  _registerProperties(node) {
    const bindings = this._searchBindings(node.textContent);
    for (const binding of bindings) { this._bind(node, binding); }

    if (node.nodeType === Node.ATTRIBUTE_NODE && node instanceof WebComponent) {
      //console.log('ASSIGNING', node.nodeName, '=' , node.textContent);
      node._ownerElement.set(node.nodeName, node.textContent);
    }
  }
  _dig(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      node._ownerElement = node.parentNode;
      return this._registerProperties(node);
    }
    if (node.attributes) {
      for (const attr of Array.from(node.attributes)) {
        //console.log(this.nodeName, node.nodeName);
        // Thanks for deprecating attr.ownerElement Mozilla!
        attr._ownerElement = node;
        if (node === this) {
          attr._ownerInstance = this;
        } else {
          attr._ownerInstance = node._ownerInstance;
        }
        this._registerProperties(attr);
      }
    }
    for (const child of Array.from(node.childNodes)) {
      //Object.defineProperty(child, '_ownerInstance', {value: this});
      child._ownerInstance = this;
      this._dig(child);
    }
  }
  _analyse() {
    console.log('--------', this.nodeName, '--------');
    Object.defineProperty(this, '_bindings', { value: {}
    });

    this._dig(this);
    if (this.shadowRoot) { this._dig(this.shadowRoot); }

    //APPLY INITIAL VALUES
    for (const p in this) {
      if (this.hasOwnProperty(p)) { this.set(p, this[p]); }
    }
  }
  set(key, value) {
    this[key] = value;
    const keyListeners = this._bindings[key] || [];
    for (const listener of keyListeners) {
      if (listener.related instanceof WebComponent) {
        if (this.called) {
          delete this.called;
        } else {
          listener.related.called = true;
          listener.related.set(listener.key, value);
        }
      }
      //UPDATE ATTRIBUTES
      let content = listener.originalValue;
      this._searchBindings(content).forEach((b) => {
        content = content.replace(b.raw, (m) => {
          return listener.host[b.key] || m;
        });
      });
      listener.node.textContent = content;
    }
  }
}

window.WebComponent = WebComponent;
