const util = require('util');

const inlineInspect = (obj: object): string => {
  return util.inspect(obj).replace(/\s*\n\s*/g, ' ');
};

export default inlineInspect;