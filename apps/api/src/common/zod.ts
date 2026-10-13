import { applyDecorators, Injectable, PipeTransform } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from '@utsavora/validation';
type ZodType = z.ZodType;
import { AppError } from './errors';
import { HttpStatus } from '@nestjs/common';

export function toValidationError(error: z.ZodError) {
  return new AppError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_ERROR',
    'Some fields need attention',
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

/** Validates and transforms input with a shared zod schema from @utsavora/validation. */
@Injectable()
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.output<T> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) throw toValidationError(r.error);
    return r.data;
  }
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

/** Documents the request body in OpenAPI from the same zod schema used for validation. */
export const ZodBody = (schema: ZodType) => applyDecorators(ApiBody({ schema: jsonSchema(schema) as never }));
