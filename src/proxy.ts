import LogFile from "./logFile";
import {everyMinutes} from "./tools/everyTime";
import getNow from "./tools/getNow";
import getInProgress from "./tools/getInProgress";
import parallel from "./tools/parallel";
import Main from "./main";
import inlineInspect from "./tools/inlineInspect";
import promiseFinally from "./tools/promiseFinally";
import {struct} from "superstruct";

const debug = require('debug')('app:proxyList');
const ProxyAgent = require('proxy-agent');
const got = require('got');
const url = require('url');

interface Agent {
  _latency: number,
  _errorCount: number,
  _successCount: number,
  proxyUri: string
}

interface ProxyLine {
  type: string,
  host: string,
  port: number,
  response_time: number,
}

const ProxyLine:(any: any) => ProxyLine = struct(struct.partial({
  type: 'string',
  host: 'string',
  port: 'number',
  response_time: 'number',
}));

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
      // @ts-ignore
      proxy.timeout = proxy.timeout || 10 * 1000;
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
      const allAgents = [].concat(this.online, this.offline);
      return parallel(8, allAgents, (agent) => {
        isVerbose && debug('check', agentToString(agent));
        return this.testAgent(agent).then((results) => {
          agent._latency = getMiddleLatency(results);
          incSuccessCount(agent);
          this.moveToOnline(agent);
        }, (err: any) => {
          if (!isProxyError(err) && err.name !== 'TimeoutError') {
            this.log.write(`Check: Proxy ${agentToString(agent)} error: ${inlineInspect(err)}`);
          }
          agent._latency = Infinity;
          incErrorCount(agent);
          this.moveToOffline(agent);
        });
      }).then(() => {
        if (this.online.length < 10) {
          isVerbose && debug('fetching...');
          return this.fetchProxies(10 - this.online.length).then((agents) => {
            const existsAgents = allAgents.map(agent => agentToString(agent));
            const newAgents = agents.filter(agent => !existsAgents.includes(agentToString(agent)));

            this.log.write(`Append:`, JSON.stringify(newAgents.map(agentToString)));
            this.online.push(...newAgents);
          }, (err: any) => {
            debug('fetchProxies error: cause: %o', err);
          });
        }
      }).then(() => {
        this.online.sort((a, b) => {
          return a._latency > b._latency ? 1 : -1;
        });

        const removedProxies: Agent[] = [];
        this.offline.slice(0).forEach((agent) => {
          if (isBrokenAgent(agent)) {
            moveTo(agent, this.offline, removedProxies);
          }
        });

        this.log.write(`Check state:`, this.online.length, '/', (this.online.length + this.offline.length));

        const online = this.online.map(agentToString);
        this.log.write(`Online:`, JSON.stringify(online));

        const offline = this.offline.map(agentToString).sort();
        this.log.write(`Offline:`, JSON.stringify(offline));

        const removed = removedProxies.map(agentToString).sort();
        this.log.write(`Removed:`, JSON.stringify(removed));
      });
    });
  }

  got(url: string, options: any):Promise<any> {
    const agent = this.getAgent();
    let timeout: NodeJS.Timeout = null;
    let proxyTimeoutFired = false;
    const request = got(url, {...options, agent}).then(...promiseFinally(() => {
      clearTimeout(timeout);
    })).catch((err: any) => {
      if (err.name !== 'HTTPError') {
        debug(`got: Proxy ${agentToString(agent)} error: %o`, err);
      }
      if (isProxyError(err) || (err.name === 'CancelError' && proxyTimeoutFired)) {
        this.moveToOffline(agent);
        if (this.hasOnline()) {
          return this.got(url, options);
        }
      }
      throw err;
    });
    timeout = setTimeout(() => {
      proxyTimeoutFired = true;
      request.cancel();
    }, 60 * 1000);
    return request;
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

  testAgent(agent: Agent) {
    return parallel(1, this.testRequests, ({url, options, skipStatusCodes}) => {
      const startTime = Date.now();
      return got(url, {
        agent,
        timeout: 10 * 1000,
        ...options
      }).catch((err: any) => {
        if (skipStatusCodes && skipStatusCodes.includes(err.response && err.response.statusCode)) {
          return;
        }
        throw err;
      }).then((res: any) => {
        const latency = Date.now() - startTime;
        return {res, latency};
      });
    });
  }

  fetchProxies(count = 10): Promise<Agent[]> {
    return got('https://github.com/fate0/proxylist/raw/master/proxy.list').then(({body}: {body: string}) => {
      const proxies: ProxyLine[] = [];
      body.split('\n').forEach((line: string) => {
        try {
          proxies.push(ProxyLine(JSON.parse(line)));
        } catch (err) {
          // pass
        }
      });
      proxies.sort(({response_time: a}, {response_time: b}) => {
        return a === b ? 0 : a < b ? -1: 1;
      });
      return proxies.map((proxy) => {
        return `${proxy.type}://${proxy.host}:${proxy.port}`;
      });
    }).then((proxies: string[]) => {
      const availableAgents: Agent[] = [];
      return parallel(8, proxies, async (proxyUrl) => {
        if (availableAgents.length >= count) return;
        const agent = new ProxyAgent(proxyUrl);
        try {
          const results = await this.testAgent(agent);
          agent._latency = getMiddleLatency(results);
          availableAgents.push(agent);
        } catch (err) {
          // pass
        }
      }).then(() => availableAgents);
    }).then((agents: Agent[]) => {
      agents.sort((a, b) => {
        return a._latency > b._latency ? 1 : -1;
      });
      return agents.slice(0, count);
    });
  }
}

function isBrokenAgent(agent: Agent) {
  const successCount = agent._successCount || 0;
  const errorCount = agent._errorCount || 0;
  const sum = successCount + errorCount;
  return (sum >= 12 && 1 / sum * successCount < 0.8);
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
    /connect ECONNREFUSED/,
    /connect EHOSTUNREACH/,
    /A "socket" was not created for HTTP request before/
  ].some(re => re.test(err.message));
}

function agentToString(agent:Agent):string {
  return `${agent.proxyUri}`;
}

function getMiddleLatency(results: {latency: number}[]) {
  return results.reduce((sum: number, {latency}) => {
    return sum + latency;
  }, 0) / results.length;
}

function incSuccessCount(agent: Agent) {
  agent._successCount = (agent._successCount || 0) + 1;
}

function incErrorCount(agent: Agent) {
  agent._errorCount = (agent._errorCount || 0) + 1;
}

export default Proxy;