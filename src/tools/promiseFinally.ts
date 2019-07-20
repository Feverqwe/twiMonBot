/**
 * @param {function} finallyFn
 * @return {(function():Promise)[]}
 */
const promiseFinally = (finallyFn: () => any): [<T>(T) => Promise<T>, <T>(T) => Promise<never|T>] => {
  return [
    <T>(result: T): Promise<T> => Promise.resolve(finallyFn()).then(() => result),
    <T>(err: T): Promise<never|T> => Promise.resolve(finallyFn()).then(() => {throw err}),
  ];
};

export default promiseFinally;