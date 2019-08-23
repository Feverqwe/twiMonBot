const timeout = 60 * 1001;

const aliases = ['get', 'post', 'put', 'patch', 'head', 'delete'];

const got = require('got').extend({
  timeout: timeout
});

const gotWithTimeout = (url: string, options: any) => {
  return got(url, options).catch((err: any) => {
    if (err.name === 'TimeoutError' && err.gotOptions.timeout === timeout) {
      err.name = 'LockTimeoutError';
    }
    throw err;
  });
};

for (const method of aliases) {
  // @ts-ignore
  gotWithTimeout[method] = (url, options) => gotWithTimeout(url, {...options, method});
}

export default gotWithTimeout;