import type { ErrorCode } from '@boogbe/shared';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do that') => new AppError('FORBIDDEN', 403, msg);
