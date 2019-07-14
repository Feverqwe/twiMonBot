const arrayDifferent = (prev, current) => {
  return prev.filter(i => current.indexOf(i) === -1);
};

export default arrayDifferent;