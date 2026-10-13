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
    const pg = exception as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const pgCode = pg?.code ?? pg?.cause?.code;
    if (pgCode === '23505') {
      return { status: 409, body: { error: { code: 'CONFLICT', message: 'This record already exists or was just changed by someone else.' } } };
    }
    if (pgCode === '23503' || pgCode === '23514' || pgCode === '22P02') {
      return { status: 422, body: { error: { code: 'INVALID_REFERENCE', message: 'The request refers to data that is invalid or missing.' } } };
    }
    if (pgCode === '40001' || pgCode === '40P01') {
      return { status: 409, body: { error: { code: 'RETRY', message: 'The record was busy. Please try again.' } } };
    }
    return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } } };
  }
}
