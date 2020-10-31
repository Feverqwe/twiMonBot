const promiseTry = <T>(callback: () => T|PromiseLike<T>): Promise<T> => {
  return new Promise(r => r(callback()));
};

export default promiseTry;