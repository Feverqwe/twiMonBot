const ensureMap = <A, B>(map: Map<A, B>, id: A, defaultValue: B): B => {
  let value = map.get(id);
  if (!value) {
    map.set(id, value = defaultValue);
  }
  return value;
};

export default ensureMap;