import { z } from 'zod';

/**
 * Accepts Indian mobile numbers with optional +91 / 91 / 0 prefix, spaces or
 * dashes, and normalises to the 10-digit form stored in the database.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-()]/g, ''))
  .transform((v) => v.replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');

export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address');

export const nameSchema = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');

export const uuidSchema = z.uuid('Invalid id');
export const idParamSchema = z.object({ id: uuidSchema });

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm (24-hour)');

export const moneySchema = z.coerce
  .number()
  .finite()
  .nonnegative()
  .max(10_000_000)
  .transform((v) => Math.round(v * 100) / 100);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Empty query-string values ('') are treated as "not provided". */
export const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
