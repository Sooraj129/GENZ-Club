export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, data?: unknown) => new AppError(400, message, data);
export const unauthorized = (message = 'Authentication required') => new AppError(401, message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, message);
export const notFound = (message = 'Resource not found') => new AppError(404, message);
export const conflict = (message: string, data?: unknown) => new AppError(409, message, data);

/** PostgreSQL error codes we translate into friendly API errors. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const;

export function isPgError(err: unknown, code?: string): err is { code: string; constraint?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (code === undefined || (err as { code: string }).code === code)
  );
}
