const arrayByPart = <T>(array: T[], len: number): T[][] => {
  const size = Math.ceil(array.length / len);
  const parts = new Array(size);
  let offset = 0;
  let index = 0;
  while (index < size) {
    const part = array.slice(offset, offset + len);
    offset += len;
    parts[index++] = part;
  }
  return parts;
};

export default arrayByPart;