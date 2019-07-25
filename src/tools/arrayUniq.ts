function arrayUniq<T>(arr: T[]): T[] {
 return arr.filter((id, index, arr) => arr.indexOf(id) === index);
}

export default arrayUniq;