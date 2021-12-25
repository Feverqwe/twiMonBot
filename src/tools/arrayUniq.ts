function arrayUniq<T>(arr: T[]) {
 return [...new Set(arr)];
}

export default arrayUniq;