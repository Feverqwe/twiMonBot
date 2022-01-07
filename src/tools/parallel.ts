import promiseTry, {Resolvable} from "./promiseTry";

const parallel = <T, F>(limit: number, items: T[], callback:(item: T, index: number, array: T[]) => Resolvable<F>):Promise<F[]> => {
  limit = Math.min(limit, items.length);
  let index = 0;
  let canceled = false;
  const results = new Array(items.length);

  const runThread = () : Promise<any> | undefined => {
    if (canceled || index >= items.length) return;

    const idx = index++;
    const item = items[idx];

    return promiseTry(() => callback(item, idx, items)).then((result) => {
      results[idx] = result;
      return runThread();
    }, (err) => {
      canceled = true;
      throw err;
    });
  };

  const threads = new Array(limit);
  for (let i = 0; i < limit; i++) {
    threads[i] = runThread();
  }
  return Promise.all(threads).then(() => results);
};

export default parallel;