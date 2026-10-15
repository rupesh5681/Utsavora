import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ThrottlerException } from '@nestjs/throttler';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** Uniform error shape. Never leaks stack traces, SQL or secrets to clients. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { id?: string }>();
    const { status, body } = this.toBody(exception);
    body.error.requestId = req.id;
    if (status >= 500) {
      this.logger.error(
        JSON.stringify({ requestId: req.id, method: req.method, path: req.path, err: exception instanceof Error ? exception.message : String(exception) }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    res.status(status).json(body);
  }

  private toBody(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof ThrottlerException) {
      return { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse() as string | { code?: string; message?: string | string[]; details?: unknown };
      if (typeof r === 'object' && r.code) {
        return { status, body: { error: { code: r.code, message: String(r.message), details: r.details } } };
      }
      const message = typeof r === 'string' ? r : Array.isArray(r.message) ? r.message.join('; ') : (r.message ?? exception.message);
      return { status, body: { error: { code: HttpStatus[status] ?? 'ERROR', message } } };
    }
    const num = sqlServerErrorNumber(exception);
    // 2627/2601: unique constraint or unique index violation.
    if (num === 2627 || num === 2601) {
      return { status: 409, body: { error: { code: 'CONFLICT', message: 'This record already exists or was just changed by someone else.' } } };
    }
    // 547: FOREIGN KEY or CHECK constraint; 8169/245/241: invalid uniqueidentifier, number or date.
    if (num === 547 || num === 8169 || num === 245 || num === 241) {
      return { status: 422, body: { error: { code: 'INVALID_REFERENCE', message: 'The request refers to data that is invalid or missing.' } } };
    }
    // 1205: chosen as deadlock victim; 1222: lock request timed out.
    if (num === 1205 || num === 1222) {
      return { status: 409, body: { error: { code: 'RETRY', message: 'The record was busy. Please try again.' } } };
    }
    return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } } };
  }
}

/** SQL Server error number from a tedious RequestError (possibly wrapped). */
export function sqlServerErrorNumber(e: unknown): number | undefined {
  const x = e as { number?: number; cause?: { number?: number }; originalError?: { number?: number; info?: { number?: number } } };
  return x?.number ?? x?.cause?.number ?? x?.originalError?.number ?? x?.originalError?.info?.number;
}
