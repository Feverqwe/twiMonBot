const getInProgress = (): <T>(callback: () => T) => Promise<T|undefined> => {
  let isInProgress = false;
  return <T>(callback: () => T): Promise<T|undefined> => {
    if (isInProgress) return Promise.resolve(undefined);
    isInProgress = true;
    // @ts-ignore
    return Promise.try(() => callback()).finally(() => {
      isInProgress = false;
    });
  };
};

export default getInProgress;