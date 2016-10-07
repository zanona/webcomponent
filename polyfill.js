function polyfill() {
  const Module = require('./module'),
        CoreWebComponent = require('./index').CoreWebComponent,
        coreProto        = CoreWebComponent.prototype,
        createdCallback  = coreProto.createdCallback,
        linkTemplate     = coreProto.linkTemplate,
        innerHTML        = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerHTML'),
        innerHTMLSet     = innerHTML.set;

  Object.defineProperty(Module.prototype, 'currentScript', {
    get() { return document._currentScript; }
  });

  Object.defineProperty(Module.prototype, 'handleLink', {
    value(link) {
      this.document.head.appendChild(link);
      //MORE: http://bit.ly/2b6P6n8
      link.__pending = [this.onLinkLoad.bind(this)];
    }
  });

  Object.defineProperty(CoreWebComponent.prototype, 'createdCallback', {
    value() {
      // RELYING ON MODULE.IMPORTED SINCE
      // THE POLYFILL MESSES UP WITH CONSTRUCTOR OBJECTS
      const name = this.getAttribute('is') || this.nodeName.toLowerCase();
      this.constructor = self.module.imported[name];
      createdCallback.bind(this)();
    }
  });

  Object.defineProperty(CoreWebComponent.prototype, 'linkTemplate', {
    value() {
      linkTemplate.bind(this)();
      self.WebComponents.ShadowCSS.shimStyling(this.shadowRoot, this.nodeName.toLowerCase());
    }
  });

  // APPARENTLY INNERHTML DOES NOT TRIGGER CREATEDCALLBACK
  // MUST FORCE SUBTREE UPGRDADE
  innerHTML.set = function (value) {
    innerHTMLSet.call(this, value);
    self.CustomElements.upgradeSubtree(this);
  };
  Object.defineProperty(HTMLElement.prototype, 'innerHTML', innerHTML);
}

module.exports = function (polyfillURL) {
  const hasCustomElement = 'registerElement' in document,
        hasImports = 'import' in document.createElement('link'),
        hasTemplates = 'content' in document.createElement('template'),
        needsPolyfill = (!hasCustomElement || !hasImports || !hasTemplates);

  function dispatchReadyEvent() {
    const readyEvent = document.createEvent('Event');
    readyEvent.initEvent('WebComponent', true, true);
    document.dispatchEvent(readyEvent);
  }

  if (needsPolyfill) {

    const script = document.createElement('script');
    script.src = polyfillURL || '//cdnjs.cloudflare.com/ajax/libs/webcomponentsjs/0.7.22/webcomponents.min.js';
    document.head.appendChild(script);
    script.addEventListener('load', polyfill);

    self.addEventListener('WebComponentsReady', () => {
      //OVERRIDE THE WAY SHADOW CSS ADD STYLES TO A SINGLE TAG
      //ALLOW EACH COMPONENT TO HAVE THEIR OWN STYLE TAG
      //THIS WILL PREVENT REFRESHING IMAGES PREVIOUSLY LOADED, ETC
      //IF STYLE TEXTCONTENT HAS BEEN UPDATED
      self.WebComponents.ShadowCSS.addCssToDocument = function (cssText, name) {
        const prev  = document.querySelector(`style[${name}]`);
        if (prev) {
          prev.textContent = cssText;
        } else {
          const style = document.createElement('style');
          style.setAttribute(name, '');
          style.setAttribute('shim-shadowdom-css', '');
          style.textContent = cssText;
          document.head.appendChild(style);
        }
      };
      dispatchReadyEvent();
    });
  } else {
    require('./module'),
    require('./index').CoreWebComponent;
    setTimeout(dispatchReadyEvent, 0);
  }
};
