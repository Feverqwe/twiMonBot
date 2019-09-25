import promiseTry from "./promiseTry";

/**
 * @param {function} finallyFn
 * @return {(function():Promise)[]}
 */
const promiseFinally = (finallyFn: () => any): [<T>(result: T) => Promise<T>, <T>(err: T) => Promise<never|T>] => {
  return [
    <T>(result: T): Promise<T> => promiseTry(finallyFn).then(() => result),
    <T>(err: T): Promise<never|T> => promiseTry(finallyFn).then(() => {throw err}),
  ];
};

export default promiseFinally;