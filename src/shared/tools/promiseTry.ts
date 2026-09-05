const promiseTry = async <T>(callback: () => PromiseLike<T> | T) => {
  return callback();
};

export default promiseTry;

export const pTry = promiseTry;
