import LogFile from "./logFile";
import {everyMinutes} from "./tools/everyTime";
import getNow from "./tools/getNow";
import getInProgress from "./tools/getInProgress";
import parallel from "./tools/parallel";
import Main from "./main";
import inlineInspect from "./tools/inlineInspect";

const debug = require('debug')('app:proxyList');
const ProxyAgent = require('proxy-agent');
const got = require('got');
const url = require('url');

interface Agent {
  _latency: number,
  proxyUri: string
}

class Proxy {
  main: Main;
  log: LogFile;
  online: Agent[];
  offline: Agent[];
  testRequests: {url: string, options?: object, skipStatusCodes?: number[]}[];
  lastTimeUsed: number;
  constructor(main: Main) {
    this.main = main;
    this.log = new LogFile('proxy');

    this.online = [];
    this.offline = [];

    this.testRequests = [];

    this.lastTimeUsed = 0;

    this.init();
  }

  init() {
    const proxyList = this.main.config.proxy.list || [];
    if (!proxyList.length) return;

    this.testRequests = this.main.config.proxy.testUrls.map((req) => {
      if (typeof req === "string") {
        return {url: req};
      }
      return req;
    });

    proxyList.map((proxy) => {
      if (typeof proxy === 'string') {
        proxy = url.parse(proxy);
      }
      const agent = new ProxyAgent(proxy);
      this.online.push(agent);
    });

    const intervalHours = this.main.config.emitCheckProxyEveryHours;
    intervalHours && everyMinutes(intervalHours * 60, () => {
      if (intervalHours * 60 * 60 > getNow() - this.lastTimeUsed) {
        this.check().catch((err) => {
          debug('check error', err);
        });
      }
    });

    if (this.main.config.proxy.checkOnRun) {
      setTimeout(() => this.check(), 1000);
    }
  }

  inProgress = getInProgress();
  check(isVerbose = false) {
    return this.inProgress(() => {
      isVerbose && debug('checking...');
      const agents = [].concat(this.online, this.offline);
      return parallel(8, agents, (agent) => {
        isVerbose && debug('check', agentToString(agent));
        return parallel(1, this.testRequests, ({url, options, skipStatusCodes}) => {
          const startTime = Date.now();
          return got(url, {
            agent,
            timeout: 10 * 1000,
            ...options
          }).catch((err: any) => {
            if (isProxyError(err) || err.name === 'TimeoutError') {
              throw err;
            }
            if (skipStatusCodes && skipStatusCodes.includes(err.response && err.response.statusCode)) {
              return;
            }
            this.log.write(`Check: Proxy ${agentToString(agent)} error: ${inlineInspect(err)}`);
            throw err;
          }).then((res: any) => {
            const latency = Date.now() - startTime;
            return {res, latency};
          });
        }).then((results) => {
          const latency = results.reduce((sum, {latency}) => {
            return sum + latency;
          }, 0) / results.length;
          agent._latency = latency;
          this.moveToOnline(agent);
        }, (err: any) => {
          agent._latency = Infinity;
          this.moveToOffline(agent);
        });
      }).then(() => {
        this.online.sort((a, b) => {
          return a._latency > b._latency ? 1 : -1;
        });

        this.log.write(`Check state:`, this.online.length, '/', this.offline.length);

        if (isVerbose) {
          const online = this.online.map(agentToString);
          this.log.write(`Online:`, online);
        }

        const offline = this.offline.map(agentToString).sort();
        this.log.write(`Offline:`, offline);
      });
    });
  }

  got(url: string, options: any):Promise<any> {
    const agent = this.getAgent();
    return got(url, {...options, agent}).catch((err: any) => {
      if (err.name !== 'HTTPError') {
        debug(`got: Proxy ${agentToString(agent)} error: %o`, err);
      }
      if (isProxyError(err)) {
        this.moveToOffline(agent);
        if (this.hasOnline()) {
          return this.got(url, options);
        }
      }
      throw err;
    });
  }

  moveToOffline(agent: Agent) {
    return moveTo(agent, this.online, this.offline);
  }

  moveToOnline(agent: Agent) {
    return moveTo(agent, this.offline, this.online);
  }

  getAgent(): Agent|undefined {
    this.lastTimeUsed = getNow();
    return this.online[0];
  }

  hasOnline() {
    this.lastTimeUsed = getNow();
    return this.online.length > 0;
  }
}

function moveTo<T>(agent: T, from:T[], to:T[]) {
  const pos = from.indexOf(agent);
  if (pos !== -1) {
    from.splice(pos, 1);
  }
  if (to.indexOf(agent) === -1) {
    to.push(agent);
  }
}

function isProxyError(err: any) {
  return [
    /connect ECONNREFUSED/
  ].some(re => re.test(err.message));
}

function agentToString(agent:Agent):string {
  return `${agent.proxyUri}`;
}

export default Proxy;