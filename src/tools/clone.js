const clone = (data) => {
  return JSON.parse(JSON.stringify({w: data})).w;
};

export default clone;