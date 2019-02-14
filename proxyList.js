const debug = require('debug')('app:proxyList');
const tunnel = require('tunnel');
const got = require('got');
const {getNow} = require('./base');

class ProxyList {
    constructor(main) {
        this.main = main;

        this.online = [];
        this.offline = [];

        this.checkPromise = null;

        this.testRequest = ['https://ya.ru'];

        this.lastTimeUsed = 0;

        this.init();
    }

    init() {
        const proxyList = this.main.config.proxyList || [];
        if (!proxyList.length) return;

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
            if (interval > getNow() - this.lastTimeUsed) {
                this.check();
            }
        }, interval * 1000);

        if (this.main.config.proxyCheckOnRun) {
            setTimeout(() => this.check(), 1000);
        }
    }

    check() {
        if (this.checkPromise) return this.checkPromise;
        // debug('checking...');

        return this.checkPromise = Promise.resolve().then(() => {
            const next = (agents) => {
                const agent = agents.shift();
                if (!agent) return;
                // debug('check', agentToString(agent));

                const [url, options] = this.testRequest;
                const startTime = Date.now();
                return got(url, Object.assign({
                    agent,
                    timeout: 10 * 1000
                }, options)).catch((err) => {
                    if (isProxyError(err) || err.name === 'TimeoutError') {
                        throw err;
                    }
                    if (err.name !== 'HTTPError') {
                        debug(`Check: Proxy ${agentToString(agent)} error: %o`, err);
                    }
                }).then(() => {
                    agent._latency = Date.now() - startTime;
                    this.moveToOnline(agent);
                }, (err) => {
                    agent._latency = Infinity;
                    this.moveToOffline(agent);
                }).then(() => {
                    return next(agents);
                });
            };

            const agents = [].concat(this.online, this.offline);
            const threads = [];
            for (let i = 0; i < 8; i++) {
                threads.push(next(agents));
            }
            return Promise.all(threads);
        }).then(() => {
            this.online.sort((a, b) => {
                return a._latency > b._latency ? 1 : -1;
            });

            debug(`Check state: %s/%s`, this.online.length, this.offline.length);

            if (false) {
                const online = this.online.map(agentToString).sort();
                debug(`Online: %j`, online);
            }

            const offline = this.offline.map(agentToString).sort();
            debug(`Offline: %j`, offline);

            this.checkPromise = null;
        });
    }

    got(url, options) {
        const agent = this.getAgent();
        return got(url, Object.assign({}, options, {agent})).catch((err) => {
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

    moveToOffline(agent) {
        return moveTo(agent, this.online, this.offline);
    }

    moveToOnline(agent) {
        return moveTo(agent, this.offline, this.online);
    }

    getAgent() {
        this.lastTimeUsed = getNow();
        return this.online[0];
    }

    hasOnline() {
        this.lastTimeUsed = getNow();
        return this.online.length > 0;
    }
}

const moveTo = (agent, from, to) => {
    const pos = from.indexOf(agent);
    if (pos !== -1) {
        from.splice(pos, 1);
    }
    if (to.indexOf(agent) === -1) {
        to.push(agent);
    }
};

const isProxyError = (err) => {
    return [
        /tunneling socket could not be established/,
        /got illegal response body from proxy/
    ].some(re => re.test(err.message));
};

const agentToString = (agent) => {
    return `${agent.proxyOptions.host}:${agent.proxyOptions.port}`;
};

module.exports = ProxyList;