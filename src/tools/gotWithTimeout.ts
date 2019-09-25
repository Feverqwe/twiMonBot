import promiseFinally from "./promiseFinally";
import ErrorWithCode from "./errorWithCode";

const aliases = ['get', 'post', 'put', 'patch', 'head', 'delete'];

const got = require('got');

const gotWithTimeout = (url: string, options: any) => {
  return gotLockTimeout(got(url, options));
};

for (const method of aliases) {
  // @ts-ignore
  gotWithTimeout[method] = (url, options) => gotWithTimeout(url, {...options, method});
}

function gotLockTimeout(request: Promise<any> & {cancel: () => void}): Promise<any> {
  let lockTimeoutFired = false;
  const timeout = setTimeout(() => {
    lockTimeoutFired = true;
    request.cancel();
  }, 60 * 1000);
  return request.then(...promiseFinally(() => {
    clearTimeout(timeout);
  })).catch((err: any) => {
    if (err.name === 'CancelError' && lockTimeoutFired) {
      const err = new ErrorWithCode('Lock timeout fired', 'ETIMEDOUT');
      err.name = 'LockTimeoutError';
      throw err;
    }
    throw err;
  });
}

export default gotWithTimeout as typeof got;