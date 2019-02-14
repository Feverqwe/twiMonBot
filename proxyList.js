const debug = require('debug')('app:proxyList');
const tunnel = require('tunnel');
const got = require('got');
const promiseLimit = require('promise-limit');
const {arrToParts} = require('./base');

class ProxyList {
    constructor(main) {
        this.main = main;

        this.online = [];
        this.offline = [];

        this.checkPromise = null;

        this.testRequst = ['https://api2.goodgame.ru/v2/streams', {
            headers: {
                'Accept': 'application/vnd.goodgame.v2+json'
            }
        }];

        this.init();
    }

    init() {
        const proxyList = this.main.config.proxyList || [];
        proxyList.map((proxy) => {
            if (typeof proxy === 'string') {
                const [host, port] = proxy.split(':');
                proxy = {host, port};
            }
            const agent = tunnel.httpsOverHttp({
                proxy
            });
            this.online.push(agent);
        });

        const interval = this.main.config.proxyCheckInterval || 21600;

        setInterval(() => {
            this.check();
        }, interval * 1000);

        setTimeout(() => {
            this.check();
        }, 1000);
    }

    check() {
        if (this.checkPromise) return this.checkPromise;
        // debug('checking...');

        const limit = promiseLimit(8);

        return this.checkPromise = Promise.resolve().then(() => {
            const next = (agents, index) => {
                const agent = agents[index];
                if (!agent) return;
                // debug('check', agentToString(agent));

                const [url, options] = this.testRequst;
                const startTime = Date.now();
                return got(url, Object.assign({
                    agent,
                    timeout: 10 * 1000
                }, options)).catch((err) => {
                    if (isProxyError(err)) {
                        throw err;
                    }
                    debug(`Check: Proxy ${agentToString(agent)} error: %o`, err);
                }).then(() => {
                    agent._latency = Date.now() - startTime;
                    this.moveToOnline(agent);
                }, (err) => {
                    agent._latency = Infinity;
                    this.moveToOffline(agent);
                }).then(() => {
                    return next(agents, index + 1);
                });
            };

            const agents = [].concat(this.online, this.offline);
            return Promise.all(arrToParts(agents, Math.trunc(agents.length / 8)).map(arr => {
                return limit(() => next(arr, 0));
            }));
        }).then(() => {
            this.online.sort((a, b) => {
                return a._latency > b._latency ? 1 : -1;
            });

            debug(`Check state: %s/%s`, this.online.length, this.offline.length);
            if (false) {
                const online = this.online.map(agentToString);
                const offline = this.offline.map(agentToString);
                debug(`Online: %j`, online);
                debug(`Offline: %j`, offline);
            }

            this.checkPromise = null;
        });
    }

    got(url, options) {
        const agent = this.getAgent();
        return got(url, Object.assign({}, options, {agent})).catch((err) => {
            debug(`got: Proxy ${agentToString(agent)} error: %o`, err);
            if (isProxyError(err)) {
                this.moveToOffline(agent);
                if (this.hasOnline()) {
                    return this.got(url, options);
                }
            }
            throw err;
        });
    }

    moveToOffline(agent) {
        return this.moveTo(agent, this.online, this.offline);
    }

    moveToOnline(agent) {
        return this.moveTo(agent, this.offline, this.online);
    }

    moveTo(agent, from, to) {
        const pos = from.indexOf(agent);
        if (pos !== -1) {
            from.splice(pos, 1);
        }
        if (to.indexOf(agent) === -1) {
            to.push(agent);
        }
    }

    getAgent() {
        return this.online[0];
    }

    hasOnline() {
        return this.online.length > 0;
    }
}

const isProxyError = (err) => {
    return /tunneling socket could not be established/.test(err.message);
};

const agentToString = (agent) => {
    return `${agent.proxyOptions.host}:${agent.proxyOptions.port}`;
};

module.exports = ProxyList;