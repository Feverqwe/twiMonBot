async function withRetry(params, callback, ...errorHandlers) {
  if (typeof params === 'function') {
    errorHandlers.unshift(callback);
    callback = params;
    params = undefined;
  }
  const {count = 3, timeout = 0} = params || {};
  let lastError = null;
  for (let i = 0; i < count; i++) {
    try {
      return await callback();
    } catch (err) {
      lastError = err;
      if (errorHandlers.some(handle => handle(err))) {
        break;
      }
      if (timeout) {
        await new Promise(r => setTimeout(r, timeout));
      }
    }
  }
  throw lastError;
}

export default withRetry;