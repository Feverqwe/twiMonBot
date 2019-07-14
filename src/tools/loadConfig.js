const fs = require('fs');
const path = require('path');

const loadConfig = (configPath, defaultConfig) => {
  Object.keys(defaultConfig).forEach(key => delete defaultConfig[key]);
  const config = JSON.parse(fs.readFileSync(configPath));
  Object.assign(defaultConfig, config);
};

export default loadConfig;