const splitByPart = (arr, limit) => {
  const result = [];
  arr = arr.slice(0);
  while (arr.length) {
    result.push(arr.splice(0, limit));
  }
  return result;
};

module.exports = splitByPart;