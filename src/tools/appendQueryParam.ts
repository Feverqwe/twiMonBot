const appendQueryParam = (url: string, key: string|number, value: string|number):string => {
  return url + (/\?/.test(url) ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(value);
};

export default appendQueryParam;