//BABEL CANNOT EXTEND NATIVE CLASSES
//CONVERT THOSE TO FUNCTION AND PROTOTYPE IT
if (typeof HTMLElement !== 'function'){
  const proto = new Function();
  proto.prototype = HTMLElement.prototype;
  HTMLElement = proto;
}

class CoreWebComponent extends HTMLElement {
  static attachTemplate(template) { this.template = template.content; }
  get root() { return this.shadowRoot; }
  linkTemplate() {
    const shadowRoot = this.createShadowRoot(),
          template = document.importNode(this.constructor.template, true);
    shadowRoot.appendChild(template);
  }
  addDescriptor(key) {
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
    if (this.constructor.template) { this.linkTemplate(); }
    // ADJUST DESCRIPTOR FOR INITAL class properties
    // ALLOWING FUNCTIONALITY SUCH AS
    // `SET KEY(VALUE) {...}` OR `GET KEY() {...}`
    Object
      .getOwnPropertyNames(this.constructor.prototype)
      .forEach(this.addDescriptor.bind(this));

    if (this.created) this.created();
  }
  attachedCallback() {
    if (this.attached) this.attached();
    this._analyse(this);
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
  static get INSTANCE_OF() { return '_ownerInstance'; }
  static get ELEMENT_OF()  { return '_ownerElement';  }
  static get NORMALIZED_NAME() { return '_normalizedNodeName'; }
  static get ORIGINAL_CONTENT() { return '_originalContent'; }
  static flattenArray(array) { return array.reduce((p, c) => p.concat(c), []); }
  static getObj(base, path) {
    const keys    = path.split(/[\.\[\]]/).filter((i) => i);
    let key,
        rBase = base || {};
    while ((key = keys.shift())) {
      if (keys.length) {
        rBase = rBase[key] ? rBase[key] : {};
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
      } else {
        if (empty) { return delete rBase[key]; }
        return rBase[key] = value;
      }
    }
  }
  static searchBindingTags(text) {
    const tag = /\[{2}([a-z-0-9-\.\_$\[\]]+)\]{2}|\{{2}([a-z-0-9-\.\_$\[\]]+)\}{2}/gi,
          tags = [];
    if (text && text.replace) {
      text.replace(tag, (originalTag, oneWayKey, twoWayKey) => {
        tags.push({
          //auto: !!twoWayKey,
          key: oneWayKey || twoWayKey,
          tag: originalTag,
          originalContent: text
        });
      });
    }
    return tags;
  }
  static searchForHostComponent(node) {
    if (node.nodeType === Node.ATTRIBUTE_NODE) { node = node._ownerElement; }
    const parent = node.parentNode;
    if (!parent) { return node.host; }
    if (parent instanceof WebComponent) { return parent; }
    return WebComponent.searchForHostComponent(parent);
  }
  static groupBindings(array) {
    const b = {};
    array.forEach((binding) => {
      b[binding.hostKey] = b[binding.hostKey] || [];
      b[binding.hostKey].push(binding);
    });
    return b;
  }
  static normalizeNodeName(nodeName) {
    return nodeName.replace(/\-(\w)/g, (_, l) => l.toUpperCase());
  }

  _findMethodScope(method) {
    let scope = this[WebComponent.INSTANCE_OF];
    while (scope && scope[method.name] !== method) scope = scope[WebComponent.INSTANCE_OF];
    return scope || this;
  }
  _updateSelfBindings(bindings) {
    // TODO REVIEW FOR ADDING DUPLICATES
    for (const key in bindings) {
      this._bindings[key] = this._bindings[key] || [];
      this._bindings[key] = this._bindings[key].concat(bindings[key]);
    }
    return this._bindings;
  }
  _bind(node, tag) {
    const isSelf = node[WebComponent.INSTANCE_OF] !== this,
          binding = {
            node            : node,
            tag             : tag.tag,
            originalContent : tag.originalContent
          };
    if (isSelf) {
      // IF BINDING IS FOUND ON OWN COMPONENT TAG
      // HOST AND RELATED SWAP POSITION
      Object.assign(binding, {
        host       : node[WebComponent.ELEMENT_OF],
        hostKey    : node[WebComponent.NORMALIZED_NAME],
        related    : node[WebComponent.INSTANCE_OF],
        relatedKey : tag.key
      });
    } else {
      Object.assign(binding, {
        host       : node[WebComponent.INSTANCE_OF],
        hostKey    : tag.key,
        related    : node[WebComponent.ELEMENT_OF],
        relatedKey : node[WebComponent.NORMALIZED_NAME]
      });
    }
    return binding;
  }
  _registerProperties(node) {
    const tags        = WebComponent.searchBindingTags(node._originalContent),
          isComponent = node[WebComponent.ELEMENT_OF] === this,
          isAttribute = node.nodeType === Node.ATTRIBUTE_NODE,
          bindings    = [];

    for (const tag of tags) {
      const binding = this._bind(node, tag);
      if (binding) bindings.push(binding);
    }

    // ONLY ALLOW SETTING INITIAL VALUES IF ATTRIBUTE
    // ON OWN COMPONENT (I.E: <X-COMPONENT SRC=FOO>)
    // EXCLUSE TAGS SINCE THOSE WILL BE EVENTUALLY BOUND AND PRESET LATER
    if (isComponent && isAttribute && !tags.length) {
      const attr = node;
      attr._ownerElement.preset(attr.name, attr._originalContent);
    }

    return bindings;
  }
  _dig(node) {
    if (!node.hasOwnProperty(WebComponent.INSTANCE_OF)) {
      Object.defineProperty(node, WebComponent.INSTANCE_OF, {value: WebComponent.searchForHostComponent(node)});
    }
    if (!node.hasOwnProperty(WebComponent.NORMALIZED_NAME)) {
      Object.defineProperty(node, WebComponent.NORMALIZED_NAME, {value: WebComponent.normalizeNodeName(node.nodeName)});
    }
    // STORE ORIGINAL CONTENT SO BINDING ANNOTATIONS CAN BE REMOVED
    if (!node.hasOwnProperty(WebComponent.ORIGINAL_CONTENT)) {
      Object.defineProperty(node, WebComponent.ORIGINAL_CONTENT, {value: node.textContent});
    }
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      return this._registerProperties(node);
    }
    if (node.nodeType === Node.TEXT_NODE) {
      Object.defineProperty(node, WebComponent.ELEMENT_OF, {value: node.parentNode});
      return this._registerProperties(node);
    }

    let bindings = [];

    if (node.attributes) {
      [...node.attributes].forEach((attribute) => {
        Object.defineProperty(attribute, WebComponent.ELEMENT_OF, {value: node});
        bindings.push(this._dig(attribute));
      });
    }

    const isSelf           = node === this,
          hasShadowRoot    = isSelf && node.shadowRoot,
          isSelfShadowRoot = (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node[WebComponent.INSTANCE_OF] === this),
          isNotComponent   = !(node instanceof WebComponent),
          isAllowedToDig   = isSelf || isSelfShadowRoot || isNotComponent;

    // DO NOT ALLOW ELEMENT DIGGING INTO ANOTHER WEBCOMPONENT
    if (isAllowedToDig) {
      bindings = bindings.concat([...node.childNodes].map(this._dig, this));
    }
    if (hasShadowRoot) {
      bindings = bindings.concat(this._dig(node.shadowRoot));
    }
    return WebComponent.flattenArray(bindings);
  }

  _analyse(nodes) {
    //ACCEPT BOTH SINGLE OR ARRAY ITEMS
    if (!Array.isArray(nodes)) nodes = [nodes];

    let bindings;
    bindings = WebComponent.flattenArray(nodes.map(this._dig, this));
    bindings = WebComponent.groupBindings(bindings);
    this._updateSelfBindings(bindings);

    for (const key in bindings) {
      this._updateListenerValues(bindings[key]);
      if (!key.match(/\./)) this.addDescriptor(key);
    }
  }
  _updateListenerNodeValue(listener) {
    let content = listener.originalContent;
    WebComponent.searchBindingTags(content).forEach((b) => {
      content = content.replace(b.tag, (_m) => {
        let target;
        if (listener.host._ownerInstance === listener.related) {
          // IF THE HOST PARENT INSTANCE IS THE SAME AS RELATED
          // IT MEANS ITS AN ATTRIBUTE REFERENCING TO THE PARENT
          // INSTANCE INSTEAD OF THE HOST ITSELF
          target = listener.related;
        } else {
          target = listener.host;
        }

        const value = WebComponent.getObj(target, b.key);

        //SKIP OBJECTS AND ARRAYS VALUES FOR ATTRIBUTE VALUES
        if (listener.node.nodeType === Node.ATTRIBUTE_NODE) {
          if (typeof value === 'object') { return ''; }
        }
        return value || '';
      });
    });
    listener.node.textContent = content;
  }
  _updateListenerValues(keyListeners, nullifyRelated) {
    for (const listener of keyListeners) {
      if (listener.related instanceof WebComponent) {
        const value        = WebComponent.getObj(listener.host,    listener.hostKey),
              relatedValue = WebComponent.getObj(listener.related, listener.relatedKey),
              ownProperty  = listener.node[WebComponent.NORMALIZED_NAME] === listener.relatedKey;
        // DO NOT ALLOW RESETING VALUES THAT ARE NOT FROM OWN ELEMENT
        // SUCH AS `USER.NAME`, BUT ONLY WHEN IT'S A SELF ATTRIBUTE
        // SUCH AS `SRC`; AN ATTR NAME MATCHES THE LISTENER KEY
        if (!nullifyRelated && typeof value === 'undefined' && !ownProperty) {
          break;
        } else if (value !== relatedValue) {
          // DO NOT SET IF VALUE IS SAME AS RELATED, AVOID ENDLESS LOOP
          listener.related.preset(listener.relatedKey, nullifyRelated ? null : value);
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
          this._updateListenerValues(keyListeners);
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
    const prevValue = WebComponent.getObj(this, key),
          valuesDiffer    = prevValue !== value,
          isValueTemplate = WebComponent.searchBindingTags(value).length,
          // DO NOT SET METHODS WHICH HAVE ALREADY BEEN BOUND
          // FN.BIND() RETURNS A FUNCTION WITHOUT PROTOTYPE
          isBoundMethod   = typeof value === 'function' && !value.prototype,
          shouldSet       = valuesDiffer && !isValueTemplate && !isBoundMethod;

    if (shouldSet) this.set(key, value, true);
  }
  set(key, value, throughPreset) {
    // IF VALUE UNDEFINED THROUGH PRESET, IGNORE IT
    // THIS WILL PREVENT DELETING OBJ VALUES
    // SINCE INITIAL `SET` ALREADY PROVIDED CORRECT VALUE
    if (throughPreset && typeof value === 'undefined') { return; }

    const keyListeners = this._bindings[key],
          prevValue = WebComponent.getObj(this, key);

    // IF PROPERTY IS A METHOD
    // BIND IT TO THE INSTANCE OWNER
    // THIS WILL ONLY BE CALLED ONCE
    if (typeof value === 'function') {
      const scope = this._findMethodScope(value);
      value = value.bind(scope);
    }

    // SETTING OBJ.VALUE
    // WILL CAUSE LISTENERS TO VALIDATED AGAINST
    // OBJ WHICH IS UNCHANGED, NOT TRIGGERING CHANGE
    if (typeof prevValue === 'function') {

      // IF THE PROPERTY IS A FUNCTION,
      // RUN THE FUNCTION WITH THE VALUE AS ATTRIBUTE
      // DO NO SET VALUE FOR THIS PROPERTY
      // SINCE IT WOULD REPLACE THE FUNCTION
      //
      // SINCE VALUE (FN) NEVER GETS ASSIGNED
      // ITS NEEDED TO ADJUST SCOPE ON CALL TIME
      const scope = this._findMethodScope(prevValue);
      prevValue.call(scope, value);
    } else {
      WebComponent.setObj(this, key, value);
    }

    // SHOULD PASS VALUE?
    if (keyListeners) {
      // FLAG NULL VALUE IN ORDER TO NULLIFY RELATED COMPONENTS
      this._updateListenerValues(keyListeners, value === null);
    }

    // LOOKUP FOR BINDINGS KEYS THAT START WITH `KEY.` or `KEY[`
    // AND UPDATE THOSE ACCORDINGLY
    //this._refreshDependentListeners(key.split(/\.|\[/)[0]);
    this._refreshDependentListeners(key);
  }
}

module.exports = {CoreWebComponent, WebComponent};
Object.defineProperty(self, 'WebComponent',  { value: WebComponent });
