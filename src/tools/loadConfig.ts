import fs from "fs";

const loadConfig = <T>(configPath: string, defaultConfig: T): T => {
  Object.keys(defaultConfig).forEach(key => delete (defaultConfig as {[s: string]: any})[key]);
  const config = JSON.parse(fs.readFileSync(configPath).toString());
  Object.assign(defaultConfig, config);
  return defaultConfig;
};

export default loadConfig;