class Quote {
    /**
     * @param {number} limitPerSecond
     */
    constructor(limitPerSecond) {
        this.limit = limitPerSecond;
        this.queue = [];
        this.time = 0;
        this.count = 0;

        this.timer = null;
    }

    _next() {
        if (this.timer !== null) return;

        const now = Date.now();
        if (now - this.time >= 1000) {
            this.time = now;
            this.count = 0;
        }

        while (this.queue.length && this.count < this.limit) {
            this.count++;
            this.queue.shift()();
        }

        if (this.count === this.limit) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this._next();
            }, 1000 - (Date.now() - this.time));
        }
    }

    /**
     * @param {function} callback
     * @returns {function:Promise}
     */
    wrap(callback) {
        return (...args) => {
            return new Promise((resolve, reject) => {
                this.queue.push(() => {
                    try {
                        resolve(callback.apply(null, args));
                    } catch (err) {
                        reject(err);
                    }
                });
                this._next();
            });
        };
    };
}

module.exports = Quote;