const _hasOwnProperty = Object.prototype.hasOwnProperty

function hasOwnProperty(object: Object, name: string) {
  return _hasOwnProperty.call(object, name)
}

export default hasOwnProperty;