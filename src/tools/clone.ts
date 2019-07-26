const clone = (data: any) => {
  return JSON.parse(JSON.stringify({w: data})).w;
};

export default clone;