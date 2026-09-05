const getInProgress = () => {
  let isInProgress = false;
  return async <T>(callback: () => Promise<T>) => {
    if (isInProgress) return;
    isInProgress = true;
    try {
      return await callback();
    } finally {
      isInProgress = false;
    }
  };
};

export default getInProgress;
