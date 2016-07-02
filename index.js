Object.defineProperty(self, 'module', {
  get() {
    const BASE_LOADING = true,
          script = document._currentScript || document.currentScript,
          doc    = script ? script.ownerDocument : document;

    function extendComponent(exported) {
      //CREATE NEW ELEMENT BASED ON TAG
      //LOOK FOR OWN PROPERTIES
      //ADD BASE PROPERTIES TO EXPORTED MODUE
      const base = Object.getPrototypeOf(document.createElement(exported.extends)),
            properties = Object.getOwnPropertyNames(base);

      for (const key of properties) {
        // DO NOT OVERWRITE CONSTRUCTOR
        if (key === 'constructor') return;
        const descriptor = Object.getOwnPropertyDescriptor(base, key);
        Object.defineProperty(exported.prototype, key, descriptor);
      }
    }
    function onLinkLoad(e) {
      const ownerDoc = e.target.import,
            template = ownerDoc.querySelector('template'),
            exported = ownerDoc.exports,
            tagName  = e.target.getAttribute('tag-name');

      if (template && exported) { exported.attachTemplate(template); }
      if (exported.extends) { extendComponent(exported); }
      document.imported[tagName] = exported;
      document.registerElement(tagName, exported);
    }
    function addLink(href, tagName) {
      const link = document.createElement('link');
      link.rel   = 'import';
      link.async = true;
      link.href  = href + '.html';
      link.setAttribute('tag-name', tagName);
      link.addEventListener('load', onLinkLoad);
      this.head.appendChild(link);
    }
    function getDocPath(href) {
      const docURL = this.documentURI.split(/[?#]/)[0];
      let path = docURL.replace(this.origin, '').split('/');
      path.pop();
      path = path.concat(href).join('/').replace(/\/\./g, '');
      return path;
    }
    function importComponent(href, tagName) {
      const absoluteHREF = getDocPath.bind(this)(href);
      tagName = tagName || href.split('.html')[0].split('/').pop();

      document.imported = document.imported || {};
      if (document.imported[tagName]) { return this; }
      document.imported[tagName] = 'pending';

      addLink.bind(BASE_LOADING ? document : this)(absoluteHREF, tagName);
      return this;
    }

    if (!doc.hasOwnProperty('import')) {
      Object.defineProperty(doc, 'import', { value: importComponent });
    }

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
      const name = this.getAttribute('is') || this.nodeName.toLowerCase();
      this.constructor = document.imported[name];
    }
    if (this.constructor.template) { this._linkTemplate(); }
    if (this.created) this.created();
  }
  attachedCallback() {
    if (this.attached) this.attached();
    this._analyse();
  }
  detachedCallback() {
    //REMOVE BINDINGS RELATED TO ELEMENT ONCE DETACHED
    const bindingKeys = this._ownerInstance._bindings;
    for (const key in bindingKeys) {
      const bindings = bindingKeys[key];
      for (const binding of bindings) {
        if (binding.related === this) {
          const index = bindings.indexOf(binding);
          bindings.splice(index, 1);
        }
      }
      //IF NO MORE BINDINGS, REMOVE KEY
      if (!bindings.length) { delete bindingKeys[key]; }
    }
    if (this.detached) this.detached();
  }
}
class WebComponent extends CoreWebComponent {
  static obj(base, path, value) {
    const getter  = typeof value === 'undefined',
          nullify = (value === null),
          keys    = path.split(/[\.\[\]]/).filter((i) => i);
    let key,
        rBase = base || {};
    while ((key = keys.shift())) {
      if (keys.length) {
        if (getter || nullify) {
          rBase = rBase[key] ? rBase[key] : rBase;
        } else {
          const isArray = !isNaN([keys[0]]);
          rBase[key] = rBase[key] || (isArray ? [] : {});
          rBase = rBase[key];
        }
      } else {
        if (getter) {
          return rBase[key];
        } else if (nullify) {
          delete rBase[key];
        } else {
          return rBase[key] = value;
        }
      }
    }
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
    if (node.nodeType === Node.ATTRIBUTE_NODE) { node = node._ownerElement; }
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
      originalValue: node._originalContent
    });
  }
  _bindRelated(node, binding) {
    const related = node._ownerInstance,
          propertyBindings = related._bindings[binding.key] = related._bindings[binding.key] || [],
          binds = propertyBindings.filter((i) => i.node === node );
    //PREVENT ADDING REPEATED BINDINGS
    if (binds.length) { return; }

    propertyBindings.push({
      raw: binding.raw,
      key: node.nodeName,
      host: related,
      related: node._ownerElement,
      node: node,
      originalValue: node._originalContent
    });
  }
  _registerProperties(node) {
    const bindings    = WebComponent.searchBindings(node._originalContent),
          isComponent = node._ownerElement instanceof WebComponent,
          isAttribute = node.nodeType === Node.ATTRIBUTE_NODE;

    for (const binding of bindings) {
      //BINDS ONLY ON COMPONENT
      this._bind(node, binding);
      //TWO-WAY BINDING ON COMPONENT OWNER
      if (isComponent && isAttribute) { this._bindRelated(node, binding); }
    }

    if (isComponent && isAttribute) {
      this._preSet(
        node._ownerElement,
        node.nodeName,
        null,
        null,
        node._originalContent
      );
    }
  }
  _dig(node) {
    const INSTANCE = '_ownerInstance',
          ELEMENT  = '_ownerElement',
          ORIGINAL = '_originalContent';
    if (!node.hasOwnProperty(INSTANCE)) {
      Object.defineProperty(node, INSTANCE, {
        value: WebComponent.searchForHostComponent(node)
      });
    }
    // STORE ORIGINAL CONTENT SO BINDING TEMPLATES CAN BE REMOVED
    if (!node.hasOwnProperty(ORIGINAL)) {
      Object.defineProperty(node, ORIGINAL, { value: node.textContent });
    }
    if (node.attributes) {
      for (const attr of Array.from(node.attributes)) {
        if (!attr.hasOwnProperty(ELEMENT)) {
          Object.defineProperty(attr, ELEMENT,  { value: node });
        }
        this._dig(attr);
      }
    }
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      this._registerProperties(node);
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
    const rValue           = WebComponent.obj(related, relatedKey),
          rValueExists     = typeof rValue !== 'undefined',
          value            = originalValue || WebComponent.obj(original, originalKey),
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
  _updateListenerNodeValue(listener) {
    let content = listener.originalValue;
    WebComponent.searchBindings(content).forEach((b) => {
      content = content.replace(b.raw, (_m) => {
        const value = WebComponent.obj(listener.host, b.key);
        //SKIP OBJECTS AND ARRAYS VALUES FOR ATTRIBUTE VALUES
        if (listener.node.nodeType === Node.ATTRIBUTE_NODE) {
          if (typeof value === 'object') { return ''; }
        }
        return value || '';
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
      this._updateListenerNodeValue(listener);
    }
  }
  _refreshDependentListeners(objName) {
    //EXPAND BEFORE CONVERTING TO REGEXP
    objName = objName
      .replace(/\$/g, '\\$')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
    Object.keys(this._bindings).forEach((b) => {
      const belongsToObject = new RegExp('^' + objName + '\\.').test(b);
      if (belongsToObject) {
        this._updateListenerValues(b, this._bindings[b]);
      }
    });
  }
  set(key, value) {
    WebComponent.obj(this, key, value);
    const keyListeners = this._bindings[key];
    if (keyListeners) { this._updateListenerValues(key, keyListeners); }

    // IF VALUE IS OBJECT, LOOK FOR BINDINGS
    // USING PATHS OF THAT OBJECT (I.E: USER.NAME)
    // AND AUTO-REFRESH THEIR LISTENER VALUES
    if (value !== null &&
        typeof value !== 'undefined' &&
        value.constructor.name === 'Object') {
      this._refreshDependentListeners(key);
    }
  }
}

self.WebComponent = WebComponent;
