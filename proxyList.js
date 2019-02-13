const debug = require('debug')('app:proxyList');
const tunnel = require('tunnel');
const got = require('got');
const promiseLimit = require('promise-limit');
const {arrToParts} = require('./base');

const oppositeType = {
    online: 'offline',
    offline: 'online',
};

class ProxyList {
    constructor(main) {
        this.main = main;

        this.online = [];
        this.offline = [];

        this.checkPromise = null;

        this.testRequst = {
            url: 'https://api2.goodgame.ru/v2/streams',
            options: {
                headers: {
                    'Accept': 'application/vnd.goodgame.v2+json'
                },
            }
        };

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

                const url = this.testRequst.url;
                const options = Object.assign({
                    agent,
                    timeout: 5 * 1000
                }, this.testRequst.options);
                const startTime = Date.now();
                return got(url, options).then(() => {
                    agent._latency = Date.now() - startTime;
                    this.moveToOnline(agent);
                }, (err) => {
                    // debug(`Check: Proxy ${agent.proxyOptions.host}:${agent.proxyOptions.port} error: %s`, err.message);
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

            if (false) {
                const online = this.online.map(agentToString);
                const offline = this.offline.map(agentToString);
                debug(`Check state: %s/%s`, online.length, offline.length);
                debug(`Online: %j`, online);
                debug(`Offline: %j`, offline);
            }

            this.checkPromise = null;
        });
    }

    got(url, options) {
        const agent = this.getAgent();
        return got(url, Object.assign({}, options, {agent})).catch((err) => {
            debug(`got: Proxy ${agent.proxyOptions.host}:${agent.proxyOptions.port} error: %s`, err.message);
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
        return this.moveTo(agent, 'offline');
    }

    moveToOnline(agent) {
        return this.moveTo(agent, 'online');
    }

    moveTo(agent, type) {
        const fromAgents = this[oppositeType[type]];
        const toAgents = this[type];
        const pos = fromAgents.indexOf(agent);
        if (pos !== -1) {
            fromAgents.splice(pos, 1);
        }
        if (toAgents.indexOf(agent) === -1) {
            toAgents.push(agent);
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