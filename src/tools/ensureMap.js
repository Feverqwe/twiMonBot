const ensureMap = (map, id, defaultValue) => {
  let value = map.get(id);
  if (!value) {
    map.set(id, value = defaultValue);
  }
  return value;
};

export default ensureMap;