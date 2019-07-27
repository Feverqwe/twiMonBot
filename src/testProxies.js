import Proxy from "./proxy";
import loadConfig from "./tools/loadConfig";

const path = require('path');

const config = {};

loadConfig(path.join(__dirname, '..', 'config.json'), config);

config.proxy.checkOnRun = false;
config.emitCheckProxyEveryHours = 0;

const proxy = new Proxy({config});

proxy.check(true);

!1 && (() => {
  const proxyCount = {};
  log.forEach((items) => {
    items.forEach((proxy) => {
      let count = proxyCount[proxy] || 0;
      proxyCount[proxy] = ++count;
    });
  });

  const result = Object.entries(proxyCount).sort(([,a],[,b]) => {
    return a === b ? 0 : a > b ? -1 : 1;
  });
  console.log(result);
})();