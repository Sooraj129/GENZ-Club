import { z } from 'zod';
import {
  CONSOLE_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ROLES,
  SESSION_STATUSES,
} from '../types/index.js';
import {
  dateSchema,
  emptyToUndefined,
  moneySchema,
  nameSchema,
  optionalEmailSchema,
  paginationSchema,
  phoneSchema,
  timeSchema,
  uuidSchema,
} from './common.js';

const opt = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

// ---------------------------------------------------------------- auth / users
export const loginSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password: z.string().min(1, 'Password is required').max(200),
});

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const createUserSchema = z.object({
  name: nameSchema,
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password: passwordSchema,
  role: z.enum(ROLES),
});

export const updateUserSchema = z.object({
  name: nameSchema.optional(),
  email: z.email().trim().toLowerCase().optional(),
  password: opt(passwordSchema),
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
});

// ------------------------------------------------------------------- customers
export const createCustomerSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
});

export const updateCustomerSchema = z.object({
  name: nameSchema.optional(),
  phone: phoneSchema.optional(),
  email: optionalEmailSchema,
});

export const customerListQuery = paginationSchema.extend({ search: opt(z.string().trim().max(100)) });
export const customerSearchQuery = z.object({ q: z.string().trim().min(1, 'Enter a name or phone').max(100) });

// -------------------------------------------------------------------- consoles
export const createConsoleSchema = z.object({
  console_number: z.string().trim().toUpperCase().min(1).max(20).regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and dashes only'),
  console_type: z.enum(CONSOLE_TYPES),
  hourly_rate: z.preprocess(emptyToUndefined, moneySchema.refine((v) => v > 0, 'Rate must be positive').nullable().optional()).transform((v) => v ?? null),
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'DISABLED']).default('AVAILABLE'),
});

export const updateConsoleSchema = z.object({
  console_number: createConsoleSchema.shape.console_number.optional(),
  console_type: z.enum(CONSOLE_TYPES).optional(),
  hourly_rate: z.preprocess(emptyToUndefined, moneySchema.refine((v) => v > 0, 'Rate must be positive').nullable().optional()),
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'DISABLED']).optional(),
});

export const consoleScheduleQuery = z.object({ date: dateSchema });

// -------------------------------------------------------------------- sessions
/** Staff enter business-local wall-clock date + time; the server converts using IST. */
export const sessionWindowSchema = z.object({
  start_date: dateSchema,
  start_time: timeSchema,
  end_date: dateSchema,
  end_time: timeSchema,
});

export const createSessionSchema = sessionWindowSchema.extend({
  customer_id: uuidSchema,
  console_id: uuidSchema,
  /** Optional: play on a membership package's prepaid hours. */
  membership_id: opt(uuidSchema),
});

export const quoteSessionSchema = sessionWindowSchema.extend({ console_id: uuidSchema, membership_id: opt(uuidSchema) });

/** Resume optionally on a different console (same type). */
export const resumeSessionSchema = z.object({ console_id: opt(uuidSchema) });

export const extendSessionSchema = z.object({
  minutes: z.coerce.number().int('Minutes must be a whole number').min(5, 'Extend by at least 5 minutes').max(12 * 60),
});

export const sessionListQuery = paginationSchema.extend({
  from: opt(dateSchema),
  to: opt(dateSchema),
  customer: opt(z.string().trim().max(100)),
  phone: opt(z.string().trim().max(15)),
  console_id: opt(uuidSchema),
  console_type: opt(z.enum(CONSOLE_TYPES)),
  status: opt(z.enum(SESSION_STATUSES)),
  payment_status: opt(z.enum(PAYMENT_STATUSES)),
});

// ------------------------------------------------------------ invoices/payments
export const invoiceListQuery = paginationSchema.extend({
  search: opt(z.string().trim().max(100)),
  from: opt(dateSchema),
  to: opt(dateSchema),
  payment_status: opt(z.enum(PAYMENT_STATUSES)),
  customer_id: opt(uuidSchema),
});

export const discountSchema = z.object({ discount: moneySchema });

export const createPaymentSchema = z.object({
  invoice_id: uuidSchema,
  amount: moneySchema.refine((v) => v > 0, 'Amount must be greater than zero'),
  payment_method: z.enum(PAYMENT_METHODS),
  reference: opt(z.string().trim().max(100)),
  idempotency_key: opt(z.string().trim().min(8).max(100)),
});

export const updatePaymentSchema = z.object({
  payment_method: z.enum(PAYMENT_METHODS).optional(),
  reference: opt(z.string().trim().max(100)).nullable(),
});

export const paymentListQuery = paginationSchema.extend({
  from: opt(dateSchema),
  to: opt(dateSchema),
  method: opt(z.enum(PAYMENT_METHODS)),
  search: opt(z.string().trim().max(100)),
});

// ------------------------------------------------------- reports / settings
export const reportQuery = z
  .object({ from: dateSchema, to: dateSchema, group: z.enum(['day', 'week', 'month']).default('day') })
  .refine((q) => q.from <= q.to, { message: 'From date must be before To date', path: ['from'] })
  .refine((q) => (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86_400_000 <= 366, {
    message: 'Report range cannot exceed one year',
    path: ['to'],
  });

export const revenueQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

export const updatePricingSchema = z.object({
  prices: z
    .array(
      z.object({
        console_type: z.enum(CONSOLE_TYPES),
        hourly_rate: moneySchema.refine((v) => v > 0 && v <= 100_000, 'Enter a rate between ₹1 and ₹1,00,000'),
      }),
    )
    .min(1),
});

export const updateSettingsSchema = z.object({
  business_name: z.string().trim().min(1).max(100).optional(),
  business_address: z.string().trim().max(300).optional(),
  business_phone: z.string().trim().max(30).optional(),
  tax_percent: z.coerce.number().min(0).max(50).optional(),
  reservation_window_minutes: z.coerce.number().int().min(0).max(240).optional(),
});

// ------------------------------------------------------------ memberships
export const membershipPlanSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  price: moneySchema,
  /** Included play time, entered in hours (e.g. 6 or 1.5). */
  hours: z.coerce.number().positive('Hours must be more than 0').max(1000),
  console_type: z.preprocess(emptyToUndefined, z.enum(CONSOLE_TYPES).nullable().optional()).transform((v) => v ?? null),
  validity_days: z.coerce.number().int().min(1).max(3650),
});

export const updateMembershipPlanSchema = membershipPlanSchema.partial().extend({ is_active: z.boolean().optional() });

export const sellMembershipSchema = z.object({ customer_id: uuidSchema, plan_id: uuidSchema });

export const membershipListQuery = paginationSchema.extend({
  search: opt(z.string().trim().max(100)),
  state: opt(z.enum(['ACTIVE', 'USED_UP', 'EXPIRED', 'CANCELLED'])),
});