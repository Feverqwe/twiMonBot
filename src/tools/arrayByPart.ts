const arrayByPart = <T>(array: T[], len: number) => {
  const size = !len ? 0 : Math.ceil(array.length / len);
  const parts = new Array<T[]>(size);
  let offset = 0;
  let index = 0;
  while (index < size) {
    parts[index++] = array.slice(offset, offset + len);
    offset += len;
  }
  return parts;
};

export default arrayByPart;