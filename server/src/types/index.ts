export const ROLES = ['ADMIN', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const CONSOLE_TYPES = ['PS4', 'PS5'] as const;
export type ConsoleType = (typeof CONSOLE_TYPES)[number];

export const CONSOLE_STATUSES = ['AVAILABLE', 'RESERVED', 'PLAYING', 'MAINTENANCE', 'DISABLED'] as const;
export type ConsoleStatus = (typeof CONSOLE_STATUSES)[number];
/** Statuses an admin sets by hand; the rest are derived from bookings. */
export const MANUAL_CONSOLE_STATUSES = ['MAINTENANCE', 'DISABLED'] as const;

export const SESSION_STATUSES = ['SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
/** Sessions in these statuses hold the console's time slot. */
export const LIVE_SESSION_STATUSES: SessionStatus[] = ['SCHEDULED', 'ACTIVE'];

export const PAYMENT_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface User extends AuthUser {
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GameConsole {
  id: string;
  console_number: string;
  console_type: ConsoleType;
  /** Per-console override; null means "use type pricing". */
  rate_override: number | null;
  /** Effective rate new sessions will be charged. */
  hourly_rate: number;
  status: ConsoleStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  customer_id: string;
  console_id: string;
  /** First time play started (kept for history). */
  start_datetime: Date;
  /** Start of the current play segment (differs from start_datetime after a resume). */
  segment_start_datetime: Date;
  /** End of the current play segment. */
  end_datetime: Date;
  actual_end_datetime: Date | null;
  /** Total play time booked (grows with extensions). */
  booked_minutes: number;
  /** Minutes played in segments that already ended (before pauses). */
  played_minutes: number;
  paused_at: Date | null;
  pause_count: number;
  duration_minutes: number | null;
  hourly_rate: number;
  estimated_amount: number;
  final_amount: number | null;
  status: SessionStatus;
  membership_id: string | null;
  /** Minutes the membership covered when the session was settled. */
  membership_minutes: number | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Session joined with display fields used across the UI. */
export interface SessionView extends Session {
  customer_name: string;
  customer_phone: string;
  console_number: string;
  console_type: ConsoleType;
  invoice_id: string | null;
  invoice_number: string | null;
  payment_status: PaymentStatus | null;
  membership_name: string | null;
}

export interface MembershipPlan {
  id: string;
  name: string;
  price: number;
  minutes: number;
  /** null = valid on any console type */
  console_type: ConsoleType | null;
  validity_days: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Membership {
  id: string;
  customer_id: string;
  plan_id: string | null;
  plan_name: string;
  console_type: ConsoleType | null;
  minutes_total: number;
  minutes_used: number;
  price: number;
  purchased_at: Date;
  expires_at: Date;
  status: 'ACTIVE' | 'CANCELLED';
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  /** Exactly one of session_id / membership_id is set. */
  session_id: string | null;
  membership_id: string | null;
  customer_id: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_status: PaymentStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference: string | null;
  paid_at: Date;
  processed_by: string | null;
  created_at: Date;
}
