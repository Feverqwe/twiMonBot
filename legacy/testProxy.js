const ProxyList = require('./proxyList');
const base = require('./base');
const config = base.loadConfig();
const proxyList = new ProxyList({config});