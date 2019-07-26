const fs = require('fs');

const loadConfig = (configPath: string, defaultConfig: {[s: string]: any}) => {
  Object.keys(defaultConfig).forEach(key => delete defaultConfig[key]);
  const config = JSON.parse(fs.readFileSync(configPath));
  Object.assign(defaultConfig, config);
};

export default loadConfig;