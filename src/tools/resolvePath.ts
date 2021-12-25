const resolvePath = <T extends Record<string, any>>(scope: T, path: string): {scope: T, endPoint: string} => {
  const parts = path.split('.');
  const endPoint = parts.pop()!;
  while (parts.length) {
    scope = scope[parts.shift()!];
  }
  return {scope, endPoint};
};

export default resolvePath;