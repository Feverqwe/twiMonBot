import promiseFinally from "./promiseFinally";
import ErrorWithCode from "./errorWithCode";

const aliases = ['get', 'post', 'put', 'patch', 'head', 'delete'];

const got = require('got');

interface gotFn {
  (url: string, options?: object): Promise<any>,
}

interface gotAliases {
  get: gotFn,
  post: gotFn,
  put: gotFn,
  patch: gotFn,
  head: gotFn,
  delete: gotFn,
}

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
      throw new ErrorWithCode('Lock timeout fired', 'LockTimeoutError');
    }
    throw err;
  });
}

export default gotWithTimeout as gotFn & gotAliases;