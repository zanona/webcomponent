class Module {
  get currentScript() { return document.currentScript; }
  get document()      { return this.currentScript ? this.currentScript.ownerDocument : document; }
  get imported()      { return this._imported = this._imported || {}; }
  get importedMap()   { return this._importedMap = this._importedMap || {}; }
  set exports(value)  { this.document.exports = value; }
  location(href) {
    const isRelative = !!href.match(/^\.+\//),
          a = document.createElement('a');
    if (isRelative) {
      const ownerLocation = this.location(this.document.baseURI),
            ownerPath     = ownerLocation.filepath.replace(ownerLocation.filename, '');
      href = ownerPath + href;
    }
    a.href = href;
    a.filepath = a.href.replace(a.search, '').replace(a.hash, '');
    if (a.filepath.match(/\w$/) && !a.filepath.match(/\.html$/)) {
      a.filepath += '.html';
    }
    a.filename = a.filepath.split('/').pop();
    return a;
  }
  extendComponent(exported) {
    //CREATE NEW ELEMENT BASED ON TAG
    //LOOK FOR OWN PROPERTIES
    //ADD BASE PROPERTIES TO EXPORTED MODUE
    const base = Object.getPrototypeOf(document.createElement(exported.extends)),
          properties = Object.getOwnPropertyNames(base);

    for (const key of properties) {
      // DO NOT OVERWRITE CONSTRUCTOR
      if (key === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(base, key);
      Object.defineProperty(exported.prototype, key, descriptor);
    }
  }
  onLinkLoad(e) {
    const ownerDoc = e.target.import,
          template = ownerDoc.querySelector('template'),
          exported = ownerDoc.exports,
          tagName  = e.target.getAttribute('tag-name'),
          pathname = this.location(ownerDoc.baseURI).pathname;

    if (template && exported) { exported.attachTemplate(template); }
    if (exported.extends) { this.extendComponent(exported); }

    this.imported[tagName] = exported;
    this.importedMap[pathname] = tagName;
    document.registerElement(tagName, exported);
  }
  handleLink(link) {
    link.addEventListener('load', this.onLinkLoad.bind(this));
    this.document.head.appendChild(link);
  }
  import(href, tagName) {
    href = this.location(href);
    if (!tagName) tagName = href.filename.replace(/\.html$/, '');

    if (this.imported[tagName]) return this;
    this.imported[tagName] = 'pending';

    const link = document.createElement('link');
    link.rel   = 'import';
    link.async = true;
    link.href  = href.filepath;
    link.setAttribute('tag-name', tagName);
    this.handleLink(link);

    return this;
  }
}
Object.defineProperty(self, 'module', { value: Object.create(Module.prototype) });
module.exports = Module;
