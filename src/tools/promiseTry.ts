export type Resolvable<R> = R | PromiseLike<R>;

const promiseTry = <T>(callback: () => Resolvable<T> | T) => {
  return new Promise<T>(r => r(callback()));
};

export default promiseTry;