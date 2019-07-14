/**
 * @param {function} finallyFn
 * @return {(function():Promise)[]}
 */
const promiseFinally = (finallyFn) => {
  return [
    result => Promise.resolve(finallyFn()).then(() => result),
    err => Promise.resolve(finallyFn()).then(() => {throw err}),
  ];
};

export default promiseFinally;