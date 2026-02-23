export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: AppErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const appErrors = {
  badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  },
  unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHORIZED', message);
  },
  forbidden(message = 'Access denied') {
    return new AppError(403, 'FORBIDDEN', message);
  },
  notFound(message = 'Resource not found') {
    return new AppError(404, 'NOT_FOUND', message);
  },
  conflict(message: string) {
    return new AppError(409, 'CONFLICT', message);
  },
  internal(message = 'Internal server error') {
    return new AppError(500, 'INTERNAL_ERROR', message);
  },
};
