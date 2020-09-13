import promiseFinally from "./promiseFinally";
import promiseTry from "./promiseTry";

const getInProgress = (): <T>(callback: () => T) => Promise<T|undefined> => {
  let isInProgress = false;
  return <T>(callback: () => T): Promise<T|undefined> => {
    if (isInProgress) return Promise.resolve(undefined);
    isInProgress = true;
    // @ts-ignore
    return promiseTry(() => callback()).finally(() => {
      isInProgress = false;
    });
  };
};

export default getInProgress;