import promiseFinally from "./promiseFinally";

const getInProgress = () => {
  let isInProgress = false;
  return (callback) => {
    if (isInProgress) return Promise.resolve();
    isInProgress = true;
    return Promise.resolve(callback()).then(...promiseFinally(() => {
      isInProgress = false;
    }));
  };
};

export default getInProgress;