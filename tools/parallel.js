/**
 * @param {number} limit
 * @param {Array} items
 * @param {function} callback
 * @return {Promise<Array>}
 */
const parallel = (limit, items, callback) => {
    limit = Math.min(limit, items.length);
    let index = 0;
    const results = new Array(items.length);

    const runThread = () => {
        if (index >= items.length) return;

        const idx = index++;
        const item = items[idx];

        return Promise.resolve(callback(item, idx, items)).then((result) => {
            results[idx] = result;
            return runThread();
        });
    };

    const threads = [];
    for (let i = 0; i < limit; i++) {
        threads.push(runThread());
    }
    return Promise.all(threads).then(() => results);
};

module.exports = parallel;