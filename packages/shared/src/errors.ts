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
  'ICAL_OVERLAP',
  'CAPACITY_EXCEEDED',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNAVAILABLE',
  'VERIFICATION_FAILED',
  'TOO_MANY_GUESTS',
  'INVALID_DATES',
  // Website listings (WL). Append-only registry (COORDINATION rule).
  'STALE',
  'SLUG_TAKEN',
  'UNIT_LINKED',
  'PUBLISH_BLOCKED',
  'PUBLISHED_BEFORE',
  'TOO_MANY_PHOTOS',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; requestId?: string };
}
