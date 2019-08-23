const timeout = 60 * 1001;

const gotWithTimeout = require('got').extend({
  timeout: timeout,
  hooks: {
    beforeError: [(err: any) => {
      if (err.name === 'TimeoutError' && err.gotOptions.timeout === timeout) {
        err.name = 'LockTimeoutError';
      }
      return err;
    }]
  }
});

export default gotWithTimeout;