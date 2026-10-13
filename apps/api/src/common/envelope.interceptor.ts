import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Page } from './page';

/** Every JSON response is { data } or { data, meta } for paginated lists. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof Page) {
          return {
            data: value.items,
            meta: { page: value.page, pageSize: value.pageSize, total: value.total, pageCount: Math.ceil(value.total / value.pageSize) },
          };
        }
        return { data: value ?? null };
      }),
    );
  }
}
