function extendComponent(exported) {
  //CREATE NEW ELEMENT BASED ON TAG
  //LOOK FOR OWN PROPERTIES
  //ADD BASE PROPERTIES TO EXPORTED MODUE
  const base = Object.getPrototypeOf(document.createElement(exported.extends)),
        properties = Object.getOwnPropertyNames(base);
  for (const key of properties) {
    const descriptor = Object.getOwnPropertyDescriptor(base, key);
    Object.defineProperty(exported.prototype, key, descriptor);
  }
}

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
    if (exported.extends) { extendComponent(exported); }
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
    Object.defineProperty(this, 'root', {
      get() { return (this._shadowRoot || this.shadowRoot); }
    });
    shadowRoot.appendChild(template);
  }
  createdCallback() {
    Object.defineProperty(this, '_bindings', { value: {} });
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
  static getObj(base, path) {
    if (path.match(/\./)) {
      for (const key of path.split('.')) {
        base = base[key];
        if (typeof base === 'undefined') { break; }
      }
      return base;
    }
    return base[path];
  }
  static setObj(base, path, value) {
    if (path.match(/\./)) {
      const keys = path.split('.');
      let key = keys.shift();
      base = base[key] = base[key] || {};
      while ((key = keys.shift())) {
        if (keys.length) {
          // IF OBJ.NAME.FIRST DOESN'T EXIST, CREATE OBJ.NAME FIRST
          base[key] = base[key] || {};
          base = base[key];
        }
        if (!keys.length) {
          base[key] = value;
        }
      }
    }
    return base[path] = value;
  }
  static searchBindings(text) {
    const tag = /\[{2}([a-z-0-9-\.\_$\[\]]+)\]{2}|\{{2}([a-z-0-9-\.\_$\[\]]+)\}{2}/gi,
          bindings = [];
    if (text && text.replace) {
      text.replace(tag, (raw, oneWayKey, twoWayKey) => {
        bindings.push({
          auto: !!twoWayKey,
          key: oneWayKey || twoWayKey,
          raw
        });
      });
    }
    return bindings;
  }
  static searchForHostComponent(node) {
    const parent = node.parentNode;
    if (!parent) { return node.host; }
    if (parent instanceof WebComponent) { return parent; }
    return WebComponent.searchForHostComponent(parent);
  }
  _bind(node, binding) {
    let from, fromKey, to, toKey;

    // IF BINDING IS FOUND ON OWN COMPONENT TAG
    // <x-component attr=[[binding]]></x-component>
    // ALWAYS HAPPENS ON ATTRIBUTE_NODE
    if (node._ownerElement === this) {
      from     = node._ownerElement;
      fromKey  = node.nodeName;
      to       = node._ownerInstance;
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

    const propertyBindings = from._bindings[fromKey] = from._bindings[fromKey] || [],
          binds = propertyBindings.filter((i) => i.node === node );
    //PREVENT ADDING REPEATED BINDINGS
    if (binds.length) { return; }

    propertyBindings.push({
      raw: binding.raw,
      key: toKey,
      host: from,
      related: to,
      node: node,
      originalValue: node.textContent
    });
  }
  _bindRelated(node, key) {
    //TODO unify with _bind
    const related = node._ownerInstance;
    WebComponent.searchBindings(key).forEach((b) => {
      const propertyBindings = related._bindings[b.key] = related._bindings[b.key] || [],
            binds = propertyBindings.filter((i) => i.node === node );
      //PREVENT ADDING REPEATED BINDINGS
      if (!binds.length) { return; }

      propertyBindings.push({
        raw: b.raw,
        key: node.nodeName,
        host: related,
        related: node._ownerElement,
        node: node,
        originalValue: node.textContent
      });
    });
  }
  _registerProperties(node) {
    const bindings    = WebComponent.searchBindings(node.textContent),
          isComponent = node._ownerElement instanceof WebComponent,
          isAttribute = node.nodeType === Node.ATTRIBUTE_NODE;

    for (const binding of bindings) { this._bind(node, binding); }

    if (isComponent && isAttribute) {
      this._bindRelated(node, node.textContent);
      this._preSet(
        node._ownerElement,
        node.nodeName,
        null,
        null,
        node.textContent
      );
    }
  }
  _dig(node) {
    const INSTANCE = '_ownerInstance',
          ELEMENT  = '_ownerElement';
    if (!node.hasOwnProperty(INSTANCE)) {
      Object.defineProperty(node, INSTANCE, {
        value: WebComponent.searchForHostComponent(node)
      });
    }
    if (node.attributes) {
      for (const attr of Array.from(node.attributes)) {
        if (!attr.hasOwnProperty(INSTANCE)) {
          Object.defineProperty(attr, ELEMENT,  { value: node });
          Object.defineProperty(attr, INSTANCE, { value: node[INSTANCE] });
        }
        this._registerProperties(attr);
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      Object.defineProperty(node, ELEMENT, {value: node.parentNode});
      this._registerProperties(node);
    }
    Array.from(node.childNodes).forEach(this._dig.bind(this));
  }
  _analyse() {
    //console.log('--------', this.nodeName, '--------');

    this._dig(this);
    if (this.shadowRoot) { this._dig(this.shadowRoot); }

    //APPLY INITIAL VALUES
    for (const key in this._bindings) {
      this._updateListenerValues(key, this._bindings[key]);
    }
  }
  _preSet(related, relatedKey, original, originalKey, originalValue) {
    const rValue           = WebComponent.getObj(related, relatedKey),
          rValueExists     = typeof rValue !== 'undefined',
          value            = originalValue || WebComponent.getObj(original, originalKey),
          valueExists      = typeof value  !== 'undefined',
          valuesDiffer     = value !== rValue,
          isRValueTemplate = WebComponent.searchBindings(rValue).length,
          isValueTemplate  = WebComponent.searchBindings(value).length;
    if (valueExists && valuesDiffer && !isValueTemplate) {
      related.set(relatedKey, value);
    } else if (original && rValueExists && valuesDiffer && !isRValueTemplate) {
      original.set(originalKey, rValue);
    }
  }
  _updateListenerAttributeValue(listener) {
    let content = listener.originalValue;
    WebComponent.searchBindings(content).forEach((b) => {
      content = content.replace(b.raw, (m) => {
        return WebComponent.getObj(listener.host, b.key) || m;
      });
    });
    listener.node.textContent = content;
  }
  _updateListenerValues(key, keyListeners) {
    for (const listener of keyListeners) {
      if (listener.related instanceof WebComponent) {
        this._preSet(
          listener.related,
          listener.key,
          this,
          key
        );
      }
      this._updateListenerAttributeValue(listener);
    }
  }
  _refreshDependentListeners(objName) {
    Object.keys(this._bindings).forEach((b) => {
      const belongsToObject = new RegExp('^' + objName + '\\.').test(b);
      if (belongsToObject) {
        this._updateListenerValues(b, this._bindings[b]);
      }
    });
  }
  set(key, value) {
    WebComponent.setObj(this, key, value);
    const keyListeners = this._bindings[key];
    if (keyListeners) { this._updateListenerValues(key, keyListeners); }

    // IF VALUE IS OBJECT, LOOK FOR BINDINGS
    // USING PATHS OF THAT OBJECT (I.E: USER.NAME)
    // AND AUTO-REFRESH THEIR LISTENER VALUES
    if (value.constructor.name === 'Object') {
      this._refreshDependentListeners(key);
    }
  }
}

window.WebComponent = WebComponent;
