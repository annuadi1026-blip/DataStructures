export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (code, msg, details) => new AppError(400, code, msg, details);
export const unauthorized = (code = 'UNAUTHORIZED', msg = 'Authentication required') => new AppError(401, code, msg);
export const forbidden = (code = 'FORBIDDEN', msg = 'You do not have permission to do that') => new AppError(403, code, msg);
export const notFound = (code = 'NOT_FOUND', msg = 'Not found') => new AppError(404, code, msg);
export const conflict = (code, msg) => new AppError(409, code, msg);
export const tooMany = (code, msg) => new AppError(429, code, msg);

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
