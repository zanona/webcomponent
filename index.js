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
  _searchForHostComponent(node) {
    while (node.parentNode) { node = node.parentNode; }
    return node.host;
  }
  _bind(node, binding) {
    let from, fromKey, to, toKey;

    // IF BINDING IS FOUND ON OWN COMPONENT TAG
    // <x-component attr=[[binding]]></x-component>
    // ALWAYS HAPPENS ON ATTRIBUTE_NODE
    if (node._ownerElement === this) {
      from     = node._ownerElement;
      fromKey  = node.nodeName;
      // SOMETIMES COMPONENTS GET ADDED IN DIFFERENT ORDER
      // INSTEAD OF RELYING ON NODE._OWNERINSTANCE WE
      // NEED TO SEARCH THE DOM TREE UPWARDS
      to       = this._searchForHostComponent(from);
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

    if (node.nodeType === Node.ATTRIBUTE_NODE && node._ownerElement instanceof WebComponent) {
      //console.log('ASSIGNING', node.nodeName, '=' , node.textContent);
      // DO NOT SET BINDING STRINGS
      if (!node.textContent.match(/^[\{\[]{2}/)) {
        node._ownerElement.set(node.nodeName, node.textContent);
      }
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

    this._dig(this);
    if (this.shadowRoot) { this._dig(this.shadowRoot); }

    //APPLY INITIAL VALUES
    for (const key in this._bindings) {
      this._updateListenerValues(key, this._bindings[key]);
    }
  }
  _updateListenerValues(key, keyListeners) {
    for (const listener of keyListeners) {
      const related = listener.related;
      if (listener.related instanceof WebComponent) {
        // TODO: COMPRESS FUNCTION / LESS NESTED
        // TODO: REFACTOR CALLED LOGIC
        if (this.called) {
          delete this.called;
          delete related.called;
          this.connection += 1;
          //console.log('ALREADY CALLED', listener.key, key);
          if (this.connection >= 3) {
            this.connection = 0;
            //console.log('CALLING AGAIN', this.connection, this.conn);
            const value = this.getObj(this, key);
            if (typeof value !== 'undefined') {
              related.set(listener.key, value);
            }
          }
        } else {
          related.called = true;
          this.connection = 1;
          // ONLY SET DEFINED VALUES;
          /*eslint max-depth: [1,4]*/
          const value = this.getObj(this, key);
          if (typeof value !== 'undefined') {
            related.set(listener.key, value);
          }
        }
      }
      //UPDATE ATTRIBUTES
      let content = listener.originalValue;
      this._searchBindings(content).forEach((b) => {
        content = content.replace(b.raw, (m) => {
          return this.getObj(listener.host, b.key) || m;
        });
      });
      listener.node.textContent = content;
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
  getObj(base, path) {
    if (path.match(/\./)) {
      for (const key of path.split('.')) {
        base = base[key];
        if (typeof base === 'undefined') { break; }
      }
      return base;
    }
    return base[path];
  }
  setObj(path, value) {
    if (path.match(/\./)) {
      const keys = path.split('.');
      let base = this[keys.shift()],
          key;
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
    return this[path] = value;
  }
  set(key, value) {
    this.setObj(key, value);
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
