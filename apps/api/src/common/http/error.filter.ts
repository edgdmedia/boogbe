import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@boogbe/shared';
import { AppError } from './app-error';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

export function toErrorBody(e: unknown): { status: number; body: ApiErrorBody } {
  if (e instanceof AppError) {
    return {
      status: e.status,
      body: {
        error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) },
      },
    };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      return {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'Already exists', details: e.meta } },
      };
    }
    if (e.code === 'P2025')
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  }
  if (
    (e instanceof Prisma.PrismaClientUnknownRequestError ||
      e instanceof Prisma.PrismaClientKnownRequestError) &&
    /23P01|exclusion constraint/.test(e.message)
  ) {
    return {
      status: 409,
      body: { error: { code: 'DATES_UNAVAILABLE', message: 'Those dates are not available' } },
    };
  }
  if (isBodyParserError(e)) {
    const message = e.status === 413 ? 'That request is too large' : 'The request body could not be read';
    return {
      status: e.status,
      body: { error: { code: STATUS_CODE[e.status] ?? 'VALIDATION_FAILED', message } },
    };
  }
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const r = e.getResponse() as { message?: string | string[]; errors?: unknown };
    const message =
      typeof r === 'string' ? r : Array.isArray(r.message) ? r.message.join('; ') : (r.message ?? e.message);
    return {
      status,
      body: {
        error: {
          code: STATUS_CODE[status] ?? 'INTERNAL',
          message,
          ...(r.errors !== undefined && { details: r.errors }),
        },
      },
    };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong' } } };
}

/** body-parser (express.json) throws plain errors carrying a 4xx `status` and a `type` such as `entity.too.large`. */
function isBodyParserError(e: unknown): e is { status: number; type: string } {
  const x = e as { status?: unknown; type?: unknown } | null;
  return typeof x?.status === 'number' && x.status >= 400 && x.status < 500 && typeof x.type === 'string';
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  catch(e: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const { status, body } = toErrorBody(e);
    if (status >= 500) this.log.error({ requestId: req.id, err: e });
    body.error.requestId = req.id;
    res.status(status).json(body);
  }
}
