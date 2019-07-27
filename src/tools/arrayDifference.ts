const arrayDifference = <T>(prev: T[], current: T[]) => {
  return prev.filter(i => current.indexOf(i) === -1);
};

export default arrayDifference;