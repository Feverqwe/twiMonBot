import PromiseQueue from "./promiseQueue";

const promiseLimit = (limit: number) => {
  const queue = new PromiseQueue(limit);
  return <T>(callback: () => T | PromiseLike<T>) => {
    return queue.add<T>(callback);
  };
};

export default promiseLimit;