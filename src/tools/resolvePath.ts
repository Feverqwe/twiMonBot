const resolvePath = <T>(scope: T, path: string): {scope: T, endPoint: string} => {
  const parts = path.split('.');
  const endPoint = parts.pop();
  while (parts.length) {
    // @ts-ignore
    scope = scope[parts.shift()];
  }
  return {scope, endPoint};
};

export default resolvePath;