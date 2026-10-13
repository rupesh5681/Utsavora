import { HttpException, HttpStatus } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(status: HttpStatus, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Resource') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have access to this resource') => new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(HttpStatus.CONFLICT, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
export const unauthorized = (message = 'Please sign in') => new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);
