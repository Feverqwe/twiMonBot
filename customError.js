function CustomError(message) {
    this.name = "CustomError";
    this.message = message;

    if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
    } else {
        this.stack = (new Error()).stack;
    }
}
CustomError.prototype = Object.create(Error.prototype);
CustomError.prototype.constructor = CustomError;
module.exports.CustomError = CustomError;

function RequestError(message) {
    CustomError.call(this, message);
    this.name = "RequestError";
}
RequestError.prototype = Object.create(CustomError.prototype);
RequestError.prototype.constructor = RequestError;
module.exports.RequestError = RequestError;