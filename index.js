Object.defineProperty(self, 'module', {
  get() {
    const BASE_LOADING = false,
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
      path = path.concat(href).join('/').replace(/\/\.\//g, '/');
      return path;
    }
    function importComponent(href, tagName) {
      const absoluteHREF = getDocPath.bind(this)(href);
      tagName = tagName || href.split('.html')[0].split('/').pop();

      document.imported = document.imported || {};
      if (document.imported[tagName]) { return this; }
      document.imported[tagName] = 'pending';

      document.importedMap = document.importedMap || {};
      document.importedMap[href] = tagName;

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
  _addDescriptor(key) {
    if (key === 'constructor') return;
    if (typeof this[key] === 'function') return;
    if (Object.getOwnPropertyDescriptor(this, key)) return;

    const proto = this.constructor.prototype,
          descriptor = Object.getOwnPropertyDescriptor(proto, key) || {};
    function defaultGet()      { return this['_' + key]; }
    function defaultSet(value) { return this['_' + key] = value; }
    function mergedGet() {
      const v = descriptor.get.bind(this)();
      if (typeof v !== 'undefined') return v;
      return defaultGet.bind(this)();
    }
    function mergedSet(value) {
      const v = descriptor.set.bind(this)(value);
      return defaultSet.bind(this)(typeof v === 'undefined' ? value : v);
    }
    Object.defineProperty(this, key, {
      configurable: true,
      get: descriptor.get ? mergedGet : defaultGet,
      set: descriptor.set ? mergedSet : defaultSet
    });
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
    // ADJUST DESCRIPTOR FOR INITAL class properties
    // ALLOWING FUNCTIONALITY SUCH AS
    // `SET KEY(VALUE) {...}` OR `GET KEY() {...}`
    Object
      .getOwnPropertyNames(this.constructor.prototype)
      .forEach(this._addDescriptor.bind(this));

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
  static getObj(base, path) {
    const keys    = path.split(/[\.\[\]]/).filter((i) => i);
    let key,
        rBase = base || {};
    while ((key = keys.shift())) {
      if (keys.length) {
        rBase = rBase[key] ? rBase[key] : {};
        if (typeof rBase === 'function') rBase = rBase._value || {};
      } else {
        return rBase[key];
      }
    }
  }
  static setObj(base, path, value) {
    const keys  = path.split(/[\.\[\]]/).filter((i) => i),
          empty = typeof value === 'undefined' || value === null;
    let key,
        rBase = base || {};
    while ((key = keys.shift())) {
      if (keys.length) {
        if (empty) {
          rBase = rBase[key] ? rBase[key] : rBase;
        } else {
          const isArray = !isNaN([keys[0]]);
          rBase[key] = rBase[key] || (isArray ? [] : {});
          rBase = rBase[key];
        }
        if (typeof rBase === 'function') rBase = rBase._value;
      } else {
        if (empty) { return delete rBase[key]; }
        return rBase[key] = value;
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
      // IF NODE IS TEXT NODE ASSING TO KEY TO
      // THE BINDING KEY, OTHERWISE IT WOULD ASSING
      // TO #TEXT WHICH WOULD POINT NOWHERE AND CONFUSE THE SYSTEM
      if (node.nodeType === Node.TEXT_NODE) { toKey = binding.key; }
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
      const attr = node;
      attr._ownerElement.preset(attr.name, attr._originalContent);
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
    if (node.nodeType === Node.ATTRIBUTE_NODE) { this._registerProperties(node); }
    if (node.nodeType === Node.TEXT_NODE) {
      Object.defineProperty(node, ELEMENT, {value: node.parentNode});
      this._registerProperties(node);
    }
    Array.from(node.childNodes).forEach(this._dig.bind(this));
  }
  _analyse(nodes) {
    //console.log('--------', this.nodeName, '--------');

    // IF NODES ARE PROVIDED, ONLY DIG SPECIFIC NODES
    // AND REFRESH BINDINGS ON THOSE
    // THIS WILL HELP NOT RE-TRIGGERING PREVIOUSLY SET BINDINGS
    if (nodes) {
      nodes.map(this._dig.bind(this));
      for (const key in this._bindings) {
        // FILTER ONLY BINDINGS THAT ARE AFFECTED
        const related = this._bindings[key].filter((binding) => {
          return nodes.indexOf(binding.related) >= 0;
        });
        // REGISTER DESCRIPTOR FOR ADDED KEYS
        if (!key.match(/\./)) this._addDescriptor(key);
        this._updateListenerValues(key, related);
      }
    } else {
      this._dig(this);
      if (this.shadowRoot) { this._dig(this.shadowRoot); }
      //APPLY INITIAL VALUES
      for (const key in this._bindings) {
        // REGISTER DESCRIPTOR FOR ADDED KEYS
        if (!key.match(/\./)) this._addDescriptor(key);
        this._updateListenerValues(key, this._bindings[key]);
      }
    }
  }
  _updateListenerNodeValue(listener) {
    let content = listener.originalValue;
    WebComponent.searchBindings(content).forEach((b) => {
      content = content.replace(b.raw, (_m) => {
        let target,
            value;
        if (listener.host._ownerInstance === listener.related) {
          // IF THE HOST PARENT INSTANCE IS THE SAME AS RELATED
          // IT MEANS ITS AN ATTRIBUTE REFERENCING TO THE PARENT
          // INSTANCE INSTEAD OF THE HOST ITSELF
          target = listener.related;
        } else {
          target = listener.host;
        }

        value = WebComponent.getObj(target, b.key);

        // IF VALUE IS FUNCTION, RENDER STORE `VALUE` PROPERTY
        if (typeof value === 'function') value = value._value;

        //SKIP OBJECTS AND ARRAYS VALUES FOR ATTRIBUTE VALUES
        if (listener.node.nodeType === Node.ATTRIBUTE_NODE) {
          if (typeof value === 'object') { return ''; }
        }
        return value || '';
      });
    });
    listener.node.textContent = content;
  }
  _updateListenerValues(key, keyListeners, nullifyRelated) {
    const value = WebComponent.getObj(this, key);
    for (const listener of keyListeners) {
      if (listener.related instanceof WebComponent) {
        const ownProperty = listener.node.name === listener.key,
              relatedValue = WebComponent.getObj(listener.related, listener.key);
        // DO NOT ALLOW RESETING VALUES THAT ARE NOT FROM OWN ELEMENT
        // SUCH AS `USER.NAME`, BUT ONLY WHEN IT'S A SELF ATTRIBUTE
        // SUCH AS `SRC`; AN ATTR NAME MATCHES THE LISTENER KEY
        if (!nullifyRelated && typeof value === 'undefined' && !ownProperty) {
          break;
        } else if (value !== relatedValue) {
          // DO NOT SET IF VALUE IS SAME AS RELATED, AVOID ENDLESS LOOP
          listener.related.preset(listener.key, nullifyRelated ? null : value);
        }
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
      const belongsToObject = new RegExp('^' + objName + '[\\.\\[]').test(b);
      if (belongsToObject) {
        const keyListeners = this._bindings[b];
        if (keyListeners) {
          this._updateListenerValues(b, keyListeners);
        } else {
          // IT MAY HAPPEN THAN WHEN AN ITEM IS DELETED
          // THE RELATED LISTENERS ARE STILL ATTACHED;
          // IN SUCH CASES, VERIFY AND DELETE IT
          delete this._bindings[b];
        }
      }
    });
  }
  preset(key, value) {
    let prevValue = WebComponent.getObj(this, key);
    //IF THIS.KEY IS FUNCTION, THEN ANALYSE AGAINST STORED `VALUE` PROPERTY
    if (typeof prevValue === 'function') prevValue = prevValue._value;
    if (typeof     value === 'function')     value =     value._value;

    const valuesDiffer    = prevValue !== value,
          isValueTemplate = WebComponent.searchBindings(value).length;

    if (valuesDiffer && !isValueTemplate) { this.set(key, value, true); }
  }
  set(key, value, throughPreset) {
    // IF VALUE UNDEFINED THROUGH PRESET, IGNORE IT
    // THIS WILL PREVENT DELETING OBJ VALUES
    // SINCE INITIAL `SET` ALREADY PROVIDED CORRECT VALUE
    if (throughPreset && typeof value === 'undefined') { return; }

    const keyListeners = this._bindings[key],
          prevValue = WebComponent.getObj(this, key);

    // SETTING OBJ.VALUE
    // WILL CAUSE LISTENERS TO VALIDATED AGAINST
    // OBJ WHICH IS UNCHANGED, NOT TRIGGERING CHANGE
    if (typeof prevValue === 'function') {
      // IF THE PROPERTY IS A FUNCTION,
      // RUN THE FUNCTION WITH THE VALUE AS ATTRIBUTE
      // AND ATTACHED STORED VALUE AS FUNCTION._VALUE
      // SO IT CAN BE CHECKED AGAINS PRESETTING LATER ON
      // ALLOW FUNCTION TO RETURN A VALUE WHICH WOULD OVERIDE THE SENT VALUE
      const fnReturn = prevValue.call(this, value);
      if (typeof fnReturn !== 'undefined') value = fnReturn;
      WebComponent.setObj(prevValue, '_value', value);
    } else {
      WebComponent.setObj(this, key, value);
    }

    // SHOULD PASS VALUE?
    if (keyListeners) {
      // FLAG NULL VALUE IN ORDER TO NULLIFY RELATED COMPONENTS
      this._updateListenerValues(key, keyListeners, value === null);
    }

    // LOOKUP FOR BINDINGS KEYS THAT START WITH `KEY.` or `KEY[`
    // AND UPDATE THOSE ACCORDINGLY
    //this._refreshDependentListeners(key.split(/\.|\[/)[0]);
    this._refreshDependentListeners(key);
  }
}

self.WebComponent = WebComponent;
