import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toErrorBody } from './error.filter';
import { AppError } from './app-error';

describe('toErrorBody', () => {
  it('maps AppError as-is', () => {
    expect(toErrorBody(new AppError('DATES_UNAVAILABLE', 409, 'Taken', { id: 'b1' }))).toEqual({
      status: 409,
      body: { error: { code: 'DATES_UNAVAILABLE', message: 'Taken', details: { id: 'b1' } } },
    });
  });
  it('maps zod validation failures to 400 VALIDATION_FAILED', () => {
    const e = new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: ['name'] }] });
    expect(toErrorBody(e)).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: [{ path: ['name'] }] } },
    });
  });
  it('maps Postgres exclusion violation 23P01 to 409 DATES_UNAVAILABLE', () => {
    const e = new Prisma.PrismaClientUnknownRequestError(
      'ERROR: conflicting key value violates exclusion constraint "booking_no_overlap" (23P01)',
      { clientVersion: '5' },
    );
    expect(toErrorBody(e).body.error.code).toBe('DATES_UNAVAILABLE');
  });
  it('maps unique violation P2002 to 409 CONFLICT', () => {
    const e = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5',
      meta: { target: ['slug'] },
    });
    expect(toErrorBody(e)).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
  });
  it('hides internals for unknown errors', () => {
    expect(toErrorBody(new Error('secret db detail'))).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
    });
  });
});
