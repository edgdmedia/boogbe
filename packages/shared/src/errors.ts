export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'ORG_SUSPENDED',
  'NO_ACTIVE_ORG',
  'LAST_ADMIN',
  'DATES_UNAVAILABLE',
  'INVALID_TRANSITION',
  'RATE_LIMITED',
  'ACCOUNT_LOCKED',
  'INTERNAL',
  'PAYLOAD_TOO_LARGE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; requestId?: string };
}
