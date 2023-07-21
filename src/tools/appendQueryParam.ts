type UriComponent = Parameters<typeof encodeURIComponent>[0];

const appendQueryParam = (url: string, key: UriComponent, value: UriComponent): string => {
  return (
    url + (/\?/.test(url) ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(value)
  );
};

export default appendQueryParam;
