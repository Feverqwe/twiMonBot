import getNow from "./getNow";

const noCacheUrl = (url: string) => {
  return url + (/\?/.test(url) ? '&' : '?') + '_=' + getNow();
};

export default noCacheUrl;