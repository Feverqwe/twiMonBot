const promiseTry = <T>(callback: () => T|Promise<T>): Promise<T> => {
  return new Promise(r => r(callback()));
};

export default promiseTry;