function arrayUniq<T>(arr: T[]): T[] {
 return [...new Set(arr)];
}

export default arrayUniq;