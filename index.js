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

    const proto = this.constructor.prototype,
          descriptor = Object.getOwnPropertyDescriptor(proto, key) || {},
          htmlDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key) || {};

    // OVERIDING INSTANCE METHODS
    // BY DEFAULT METHODS ARE NOT BOUND TO INSTANCE ITSELF
    // WHERE `THIS` BECOMES ANYTHING SET BY THE CALLER
    // WE ARE FORCING BINDING EVERY METHOD TO THE INSTANCE
    // TO MAKE DEVELOPMENT MORE FLUID, GENERATING CLEANER CODE

    if (!descriptor.hasOwnProperty('set') && !descriptor.hasOwnProperty('get')) {
      const newDescriptor = { configurable: true, value: descriptor.value.bind(this) };
      Object.defineProperty(this, key, newDescriptor);
      return;
    }

    // OVERIDING GETTERS AND SETTERS
    // ONCE SETTING A GETTER, A SETTER IS AUTOMATICALLY SET TO UNDEFINED
    // IN CASE ITS NOT DELCARED, AND VICE VERSA

    function defaultGet() {
      const value = this['_' + key];
      if (typeof value !== 'undefined') return value;
      if (htmlDescriptor.get) { return htmlDescriptor.get.call(this); }
    }
    function defaultSet(value) {
      //IF HTML ATTRIBUTE SUCH AS HIDDEN, CALL IT AS WELL
      if (htmlDescriptor.set) htmlDescriptor.set.call(this, value);
      return this['_' + key] = value;
    }
    function mergedGet() {
      const v = descriptor.get.bind(this)();
      if (typeof v !== 'undefined') return v;
      return defaultGet.call(this);
    }
    function mergedSet(value) {
      const customValue = descriptor.set.bind(this)(value),
            hasCustomValue = typeof customValue !== 'undefined';

      value = hasCustomValue ? customValue : value;
      defaultSet.call(this, value);

      if (hasCustomValue) this._refreshRelatedListeners(key);
      return value;
    }

    var newDescriptor = {
      configurable: true,
      get: descriptor.get ? mergedGet : defaultGet,
      set: descriptor.set ? mergedSet : defaultSet
    };

    Object.defineProperty(this, key, newDescriptor);
  }
  createdCallback() {
    // ADJUST DESCRIPTOR FOR INITAL class properties
    // ALLOWING FUNCTIONALITY SUCH AS
    // `SET KEY(VALUE) {...}` OR `GET KEY() {...}`
    // COMES AS FIRST SO OTHER METHOS HAVE ALL PROPERTIES DEFINED
    // FOR PARSING (I.E: _FINDMETHODSCOPE);
    Object
      .getOwnPropertyNames(this.constructor.prototype)
      .forEach(this.addDescriptor, this);

    Object.defineProperty(this, '_bindings', { value: {} });

    if (this.constructor.template) { this.linkTemplate(); }
    if (this.created) this.created();
  }
  attachedCallback() {
    this._analyse(this);
    if (this.attached) this.attached();
  }
  detachedCallback() {
    //REMOVE BINDINGS RELATED TO ELEMENT ONCE DETACHED

    //FIXME SAFARI DOING SOME STRANGE THINGS
    if (!this._ownerInstance && !this.treeScope_ && !this.treeScope_.parent) { 
      return console.log('NO PARENT FOUND', this);
    }

    const parent = this._ownerInstance || this.treeScope_.parent,
          bindingKeys = parent._bindings;

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
  static get IS_SHADOW()   { return '_isShadow'; }
  static flattenArray(array) { return array.reduce((p, c) => p.concat(c), []); }
  static isEqual(a, b, strict) {
    const typeA = typeof a,
          typeB = typeof b;

    if (typeA !== typeB) return false;

    if (typeA === 'function') a = a.toString();
    if (typeB === 'function') b = b.toString();

    if (strict) {
      if (typeA === 'object') a = JSON.stringify(a);
      if (typeB === 'object') b = JSON.stringify(b);
    }

    return a === b;
  }
  static isHTMLBooleanAttribute(key) {
    //MORE: https://github.com/kangax/html-minifier/issues/63
    return (/^(?:allowfullscreen|async|autofocus|autoplay|checked|compact|controls|declare|default|defaultchecked|defaultmuted|defaultselected|defer|disabled|draggable|enabled|formnovalidate|hidden|indeterminate|inert|ismap|itemscope|loop|multiple|muted|nohref|noresize|noshade|novalidate|nowrap|open|pauseonexit|readonly|required|reversed|scoped|seamless|selected|sortable|spellcheck|translate|truespeed|typemustmatch|visible)$/).test(key);
  }

  static getObjLastAvailableProperty(base, path) {
    const keys = path.split(/[\.\[\]]/).filter((i) => i),
          isArrayKey = (k) => !isNaN(k),
          keyPath = [];
    let key,
        rBase = base || {};

    while ((key = keys.shift())) {
      keyPath.push(key);
      if (!rBase[key]) break;
      const nextKey         = keys[0],
            current         = rBase[key],
            next            = current[nextKey],
            hasNext         = typeof next !== 'undefined',
            isCurrentArray  = Array.isArray(current);

      if (isArrayKey(nextKey) && !isCurrentArray) break;
      if (!hasNext) break;
      rBase = current;
    }
    return { path: keyPath, value: rBase };
  }
  static getObj(base, path) {
    const keys = path.split(/[\.\[\]]/).filter((i) => i),
          isArrayKey = (k) => !isNaN(k);
    let key,
        rBase = base || {};

    while ((key = keys.shift())) {
      const current = rBase[key],
            isCurrentArray = Array.isArray(rBase);
      if (isArrayKey(key) && !isCurrentArray) return;
      if (typeof current === 'undefined' || current === null) return current;
      rBase = current;
    }
    return rBase;
  }

  static applyValue(base, key, value) {
    const nullify = typeof value === 'undefined' || value === null;

    let descriptor = Object.getOwnPropertyDescriptor(base, key);
    descriptor = descriptor && (descriptor.get || descriptor.set);

    if (nullify && Array.isArray(base)) {
      //IF NULLIFYING ARRAY ITEM, REMOVE ITEM FROM ARRAY
      base.splice(key, 1);
    } else if (nullify && !descriptor) {
      //IF NO GETTER/SETTER, OK TO DELETE PROPERTY
      delete base[key];
    } else {
      //PRESERVE NULL IN ORDER TO PROGRATE NULLIFY ACTION
      base[key] = value;
    }
  }
  static objAssign(target, source = {}) {
    const keys = Object.getOwnPropertyNames(source);
    keys.forEach((key) => target[key] = source[key] );
    return target;
  }
  static setObj(base, path, value) {
    const keys    = path.split(/[\.\[\]]/).filter((i) => i),
          nullify = typeof value === 'undefined' || value === null,
          isArray = (k) => !isNaN(k),
          copy    = WebComponent.objAssign({}, base),
          keysCopy= [];

    let key, rBase = copy;

    while ((key = keys.shift())) {

      if (!keys.length) break;
      keysCopy.push(key);

      const prev      = rBase,
            targetObj = isArray(keys[0]) ? [] : {};

      let current = rBase[key];

      if (current) rBase = current;

      if (typeof current !== 'object') current = null;
      if (nullify && !current) break;

      prev[key] = Object.assign(targetObj, current);

      rBase = prev[key];
    }

    rBase[key] = value;
    //DO NOT TRIGGER APPLYVALUE SINCE NULLIFY WOULD DELETE PROPERTY
    //LOSING NULLIFY ACTION WHEN APPLIED TO ORIGINAL OBJECT
    //SINCE IT WOULD BE UNDEFINED
    //WebComponent.applyValue(rBase, key, value);

    //ACTIVATE SETTERS IN BASE OBJ IN THE PROPER ORDER (INSIDE OUT)
    function refreshOriginalObj() {
      const lastBase = WebComponent.getObjLastAvailableProperty(base, keysCopy.join('.')),
            lastPath = lastBase.path.join('.'),
            lastCopy = this.getObj(copy, lastPath),
            lastKey  = lastBase.path.pop();

      WebComponent.applyValue(lastBase.value, lastKey, lastCopy);

      let k;
      while ((k = lastBase.path.pop())) {
        const p = lastBase.path.join('.'),
              v = WebComponent.getObj(base, p);
        v[k] = v[k];
      }
    }

    keysCopy.push(key);
    refreshOriginalObj.call(this);

    return value;
  }

  static searchBindingTags(text) {
    const tag = /\[{2}([a-z-0-9-\.\_$\[\]]+)\]{2}|\{{2}([a-z-0-9-\.\_$\[\]]+)\}{2}/gi,
          tags = [];
    if (text && text.replace) {
      text.replace(tag, (originalTag, oneWayKey, twoWayKey) => {
        tags.push({
          auto: !!twoWayKey,
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
    if (parent instanceof WebComponent) return parent;
    //FALLBACK TO GENERAL CUSTOM-ELEMENT AS PARENT
    //IN CASE MODULE HASN’T BEEN DOWNLOADED
    //LOOKS UP FOR ELEMENTS WITH HYPEN I.E: APP-FOO
    //WILL POTENTIALLY NEED TO CHANGE THIS SINCE IT WOULDN’T PLAY
    //WELL WITH OTHER CUSTOM ELEMENT LIBRARIES IN THE SAME PROJECT
    if (parent.nodeType === Node.ELEMENT_NODE && /-/.test(parent.nodeName))  {
      return parent;
    }
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

  _lookupMethodOnScope(method, scope) {
    //COMPARE AGAINST ALL AVAILABLE PROPERTIES ON OBJECT
    //RATHER THAN UNRELIABLE FN.NAME THAT CAN BE CHANGED
    //THROUGH POST-PROCESSING
    const keys = Object.getOwnPropertyNames(scope);
    return keys.find((k) => scope[k] === method);
  }
  _findMethodScope(method, key) {
    let scope = this[WebComponent.INSTANCE_OF];

    while (scope && !this._lookupMethodOnScope(method, scope)) {
      scope = scope[WebComponent.INSTANCE_OF]; //GO UP
    }
    //IF IT CANT FIND ON PARENT LOOK FOR BINDINGS
    if (!scope) {
      //ONCE HITS TOPMOST LEVEL, LOOK FOR BINDINGS
      //CHECKING SCOPE RELATION HORIZONTALLY
      const bindings = this._bindings[key];
      if (bindings) scope = bindings[0].related;
    }
    return scope;
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
            auto            : tag.auto,
            originalContent : tag.originalContent
          },
          selfBinding = () => {
            return Object.assign({
              host       : node[WebComponent.ELEMENT_OF],
              hostKey    : node[WebComponent.NORMALIZED_NAME],
              related    : node[WebComponent.INSTANCE_OF],
              relatedKey : tag.key
            }, binding);
          },
          internalBinding = () => {
            const b = Object.assign({
              host       : node[WebComponent.INSTANCE_OF],
              hostKey    : tag.key,
              related    : node[WebComponent.ELEMENT_OF],
              relatedKey : node[WebComponent.NORMALIZED_NAME]
            }, binding);
            //IF RELATED IS TEXTCONTENT OF A NODE
            //THEN USE THE NODE ITSELF AS RELATED
            if (b.relatedKey === '#text') b.related = node;
            return b;
          };
          /*
          externalBinding = () => {
            const b = Object.assign({
              host       : node[WebComponent.INSTANCE_OF][WebComponent.INSTANCE_OF],
              hostKey    : tag.key,
              related    : node[WebComponent.ELEMENT_OF],
              relatedKey : node[WebComponent.NORMALIZED_NAME]
            }, binding);
            if (b.relatedKey === '#text') b.related = node;
            return b;
          };
          */
    if (isSelf) {
      // IF BINDING IS FOUND ON OWN COMPONENT TAG
      // HOST AND RELATED SWAP POSITION
      //
      // ATTEMPT TO ALLOW TWO WAY BINDING ON CUSTOM ELEMENT CHILD NODE TREE
      // if (node.nodeType !== Node.ATTRIBUTE_NODE && !node[WebComponent.IS_SHADOW]) {
      //   return externalBinding();
      // }
      return selfBinding();
    } else {
      return internalBinding();
    }
  }
  _registerProperties(node) {
    const tags        = WebComponent.searchBindingTags(node._originalContent),
          nodeOwner   = node[WebComponent.ELEMENT_OF],
          isComponent = nodeOwner === this,
          isAttribute = node.nodeType === Node.ATTRIBUTE_NODE,
          bindings    = [];

    for (const tag of tags) {
      const binding = this._bind(node, tag);
      if (binding) bindings.push(binding);
      // CLEAN UP TAG VALUES ON NODES
      node.textContent = node.textContent.replace(tag.tag, '');
    }

    // CHECK THROUGH OTHER NODES THAT SET PROPERTIES ON THIS COMPONENT
    // BEFORE IT WAS CREATED, SET INITIAL ONES WHEN FOUND
    if (tags.length && nodeOwner instanceof WebComponent && nodeOwner !== this) {
      const name         = WebComponent.normalizeNodeName(bindings[0].hostKey),
            relatedValue = WebComponent.getObj(bindings[0].related, bindings[0].relatedKey),
            prevValue    = WebComponent.getObj(this, name);
      this.preset(name, relatedValue, prevValue);
    }

    // ONLY ALLOW SETTING INITIAL VALUES IF ATTRIBUTE
    // ON OWN COMPONENT (I.E: <X-COMPONENT SRC=FOO>)
    if (isComponent && isAttribute) {
      const name         = WebComponent.normalizeNodeName(node.name),
            value        = node[WebComponent.ORIGINAL_CONTENT],
            prevValue    = WebComponent.getObj(this, name),
            relatedValue = bindings[0] && WebComponent.getObj(bindings[0].related, bindings[0].relatedKey);
            //TODO: CHECK MULTIPLE TAGS/BINDINGS

      if (tags.length) {
        if (typeof relatedValue === 'undefined' ||
            //typeof relatedValue === 'function'  ||
            typeof prevValue    === 'function') return bindings;
        this.preset(name, relatedValue, prevValue);
      } else {
        if (typeof value === 'undefined' ||
            typeof value === 'function') return bindings;
        this.preset(name, value, prevValue);
      }
    }

    return bindings;
  }
  _dig(node, definitions = {}) {
    if (!node.hasOwnProperty(WebComponent.INSTANCE_OF)) {
      Object.defineProperty(node, WebComponent.INSTANCE_OF, {value: WebComponent.searchForHostComponent(node)});
    }

    if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      if (definitions.shadow && !node.hasOwnProperty(WebComponent.IS_SHADOW)) {
        Object.defineProperty(node, WebComponent.IS_SHADOW, {value: true});
      }
    }

    if (!node.hasOwnProperty(WebComponent.NORMALIZED_NAME)) {
      Object.defineProperty(node, WebComponent.NORMALIZED_NAME, {value: WebComponent.normalizeNodeName(node.nodeName)});
    }
    // STORE ORIGINAL CONTENT SO BINDING ANNOTATIONS CAN BE REMOVED
    if (!node.hasOwnProperty(WebComponent.ORIGINAL_CONTENT)) {
      Object.defineProperty(node, WebComponent.ORIGINAL_CONTENT, {value: node.textContent});
    }
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      // PREVENT EXTENDING STYLE ATTRIBUTES
      // SINCE IT WOULD CONFLICT WITH CSS PARSER
      if (node.name !== 'style') return this._registerProperties(node);
    }
    if (node.nodeType === Node.TEXT_NODE) {
      Object.defineProperty(node, WebComponent.ELEMENT_OF, {value: node.parentNode});
      return this._registerProperties(node);
    }

    let bindings = [];

    const isSelf           = node === this,
          hasShadowRoot    = isSelf && node.shadowRoot,
          isSelfShadowRoot = (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node[WebComponent.INSTANCE_OF] === this),
          isNotComponent   = !(node instanceof WebComponent),
          isAllowedToDig   = isSelf || isSelfShadowRoot || isNotComponent;

    if (node.attributes) {
      [...node.attributes].forEach((attribute) => {
        Object.defineProperty(attribute, WebComponent.ELEMENT_OF, {value: node});
        bindings.push(this._dig(attribute));
      });
    }

    // DO NOT ALLOW ELEMENT DIGGING INTO ANOTHER WEBCOMPONENT
    if (isAllowedToDig) {
      bindings = bindings.concat([...node.childNodes]
                         .map((n) => this._dig(n, definitions), this));
    }
    if (hasShadowRoot) {
      bindings = bindings.concat(this._dig(node.shadowRoot, {shadow: true}));
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

    for (const key in bindings) this._refreshRelatedListeners(key, void 0, bindings);
  }
  _updateListenerNodeValue(listener) {
    let content = listener.originalContent;
    WebComponent.searchBindingTags(content).forEach((b) => {
      content = content.replace(b.tag, (_m) => {
        let target;
        if (listener.host[WebComponent.INSTANCE_OF] === listener.related) {
          // IF THE HOST PARENT INSTANCE IS THE SAME AS RELATED
          // IT MEANS ITS AN ATTRIBUTE REFERENCING TO THE PARENT
          // INSTANCE INSTEAD OF THE HOST ITSELF
          target = listener.related;
        } else {
          target = listener.host;
        }

        const value = WebComponent.getObj(target, b.key);

        //SKIP OBJECTS AND ARRAYS VALUES FOR ATTRIBUTE VALUES
        if (value && listener.node.nodeType === Node.ATTRIBUTE_NODE) {
          const valueType = typeof value;
          if (valueType.match(/object|function/)) { return ''; }
        }
        return typeof value === 'undefined' || value === null ? '' : value;
      });
    });
    listener.node.textContent = content;
  }
  _getRelatedListenersForPath(path) {
    //EXPAND BEFORE CONVERTING TO REGEXP
    path = path
      .replace(/\$/g, '\\$')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');

    let expr = /^path$|^path[\.\[]/;
    expr = new RegExp(expr.source.replace(/path/g, path));

    return Object.keys(this._bindings)
      .filter((key)  => expr.test(key))
      //SORT FROM SMALL TO LARGE PATH TO SPREAD VALUES IN CORRECT ORDER
      //NOT SURE IF NECESSARY BUT IT SEEMS CLEANER
      .sort((a, b)   => a.split('.').length > b.split('.').length ? 1 : -1)
      .map((key)     => this._bindings[key])
      .reduce((p, c) => p.concat(c), []);
  }
  _refreshRelatedListeners(key, nullifyRelated, bindings) {
    const listeners = bindings ? bindings[key] : this._getRelatedListenersForPath(key);

    for (const listener of listeners) {
      if (listener.related instanceof WebComponent) {

        let value = WebComponent.getObj(listener.host, listener.hostKey);
        const prevValue = WebComponent.getObj(listener.related, listener.relatedKey),
              relatedReady = Object.keys(listener.related._bindings).length;

        if (nullifyRelated && typeof value === 'undefined') value = null;

        // IF RELATED COMPONENT IS NOT READY (HAS NOT BEEN ANALYZED)
        // LEAVE TO THE _RegisterProperties METHOD TO ASSIGN IT WHEN
        // THE RELATED COMPONENT IS CREATED
        if (relatedReady && typeof value !== 'function') {
          listener.related.preset(listener.relatedKey, value, prevValue);
        }
      }
      this._updateListenerNodeValue(listener);
    }
  }
  preset(key, value, prevValue) {
    //IF VALUE IS EMPTY STRING ON HTML BOOLEAN ATTRIBUTE
    //SUCH AS HIDDEN, CONVERT TO TRUE
    if (WebComponent.isHTMLBooleanAttribute(key) && value === '') value = true;

    const hasValue        = typeof value !== 'undefined',
          valuesDiffer    = hasValue && !WebComponent.isEqual(prevValue, value),
          isValueTemplate = WebComponent.searchBindingTags(value).length,
          // DO NOT SET METHODS WHICH HAVE ALREADY BEEN BOUND
          isBoundMethod = typeof value === 'function' && value.bound,
          shouldSet = valuesDiffer && !isValueTemplate && !isBoundMethod,
          shouldNullify = prevValue !== null && typeof prevValue !== 'undefined',
          shouldProceed = value === null ? shouldNullify : shouldSet;

    if (shouldProceed) this.set(key, value);
  }
  set(key, value, opts) {
    // IF FORCE ATTRIBUTE IS TRUE
    // CLONE OBJECT IN ORDER TO RE-REFRESH LISTENERS
    if (opts && opts.force && typeof value === 'object' && value !== null) {
      value = JSON.parse(JSON.stringify(value));
    }
    const prevValue = WebComponent.getObj(this, key);
    // IF PROPERTY IS A METHOD
    // BIND IT TO THE INSTANCE OWNER
    // THIS WILL ONLY BE CALLED ONCE
    if (typeof value === 'function') {
      const scope = this._findMethodScope(value, key);
      value = value.bind(scope);
      //FLAG THAT METHOD HAS BEEN BOUND SO IT CAN BE IDENTIFIABLE
      //RELYING ON PROTOTYPE SEEMS FAULTY
      Object.defineProperty(value, 'bound', {value: true});
    }

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
      // SETTING OBJ.VALUE
      // WILL CAUSE LISTENERS TO VALIDATED AGAINST
      // OBJ WHICH IS UNCHANGED, NOT TRIGGERING CHANGE
      WebComponent.setObj(this, key, value);
    }

    //CHECK FOR NULL TO BE SPREAD ACROSS RELATED LISTENERS DOWN THE CHAIN
    this._refreshRelatedListeners(key, value === null);
  }
  broadcast(key) {
    const listeners = this._getRelatedListenersForPath(key);
    for (const listener of listeners) {
      const keys = listener.relatedKey.split(/[\.\[\]]/).filter((i) => i),
            lastKey = keys.pop(),
            lastObj = WebComponent.getObj(listener.related, keys.join('.'));
      //BROADCAST BY ACTIVATING SETTER
      lastObj ? lastObj[lastKey] = lastObj[lastKey] : void 0;
    }
  }
}

module.exports = {CoreWebComponent, WebComponent};
Object.defineProperty(self, 'WebComponent',  { value: WebComponent });
