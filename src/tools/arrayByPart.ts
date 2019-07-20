const arrayByPart = <T>(array: T[], len: number): T[][] => {
  array = array.slice(0);
  const parts = [];
  while (array.length) {
    parts.push(array.splice(0, len));
  }
  return parts;
};

export default arrayByPart;