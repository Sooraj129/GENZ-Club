export type Role = 'ADMIN' | 'STAFF';
export type ConsoleType = 'PS4' | 'PS5';
export type ConsoleStatus = 'AVAILABLE' | 'RESERVED' | 'PLAYING' | 'MAINTENANCE' | 'DISABLED';
export type SessionStatus = 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export type PaymentStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active?: boolean;
  created_at?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerWithStats extends Customer {
  total_sessions: number;
  total_spent: number;
  last_visit: string | null;
}

export interface GameConsole {
  id: string;
  console_number: string;
  console_type: ConsoleType;
  rate_override: number | null;
  hourly_rate: number;
  status: ConsoleStatus;
  current_session_id?: string | null;
  current_customer_name?: string | null;
  current_end_datetime?: string | null;
  next_start_datetime?: string | null;
}

export interface Session {
  id: string;
  customer_id: string;
  console_id: string;
  /** First start (history). */
  start_datetime: string;
  /** Start of the current play segment — differs from start_datetime after a resume. */
  segment_start_datetime: string;
  /** End of the current play segment. */
  end_datetime: string;
  actual_end_datetime: string | null;
  /** Total play time booked; played_minutes = minutes played before the last pause. */
  booked_minutes: number;
  played_minutes: number;
  paused_at: string | null;
  pause_count: number;
  duration_minutes: number | null;
  hourly_rate: number;
  estimated_amount: number;
  final_amount: number | null;
  status: SessionStatus;
  membership_id: string | null;
  membership_name: string | null;
  /** Minutes covered by the membership when settled. */
  membership_minutes: number | null;
  customer_name: string;
  customer_phone: string;
  console_number: string;
  console_type: ConsoleType;
  invoice_id: string | null;
  invoice_number: string | null;
  payment_status: PaymentStatus | null;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference: string | null;
  paid_at: string;
  invoice_number: string;
  invoice_total: number;
  customer_name: string;
  customer_phone: string;
  processed_by_name: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  /** SESSION = gaming session; MEMBERSHIP = package sale (no console fields). */
  kind: 'SESSION' | 'MEMBERSHIP';
  session_id: string | null;
  membership_id: string | null;
  customer_id: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_status: PaymentStatus;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  console_number: string | null;
  console_type: ConsoleType | null;
  start_datetime: string | null;
  end_datetime: string | null;
  actual_end_datetime: string | null;
  duration_minutes: number | null;
  hourly_rate: number | null;
  session_status: SessionStatus | null;
  membership_minutes: number | null;
  membership_name: string | null;
  membership_minutes_total: number | null;
  membership_expires_at: string | null;
  amount_paid: number;
}

export interface BusinessSettings {
  business_name: string;
  business_address: string;
  business_phone: string;
  tax_percent: number;
  reservation_window_minutes: number;
}

export interface InvoiceDetail extends Invoice {
  balance_due: number;
  payments: Payment[];
  business: BusinessSettings;
}

export interface Pricing {
  id: string;
  console_type: ConsoleType;
  hourly_rate: number;
  updated_at: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totalAmount?: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface DashboardSummary {
  date: string;
  today_revenue: number;
  today_collected: number;
  active_sessions: number;
  upcoming_sessions: number;
  available_consoles: number;
  total_consoles: number;
  today_sessions: number;
  pending_amount: number;
  pending_invoices: number;
  consoles: GameConsole[];
  active_sessions_list: Session[];
  upcoming_sessions_list: Session[];
  server_time: string;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
  ps4_revenue: number;
  ps5_revenue: number;
  membership_revenue: number;
  sessions: number;
}

export interface ReportData {
  from: string;
  to: string;
  group: 'day' | 'week' | 'month';
  summary: {
    sessions: number;
    revenue: number;
    ps4_revenue: number;
    ps5_revenue: number;
    membership_revenue: number;
    collected: number;
    played_minutes: number;
    finished_sessions: number;
    pending_payments: number;
    avg_duration_minutes: number;
    utilization_percent: number;
  };
  series: Array<{
    date: string;
    sessions: number;
    revenue: number;
    ps4_revenue: number;
    ps5_revenue: number;
    membership_revenue: number;
    collected: number;
    played_minutes: number;
    avg_duration_minutes: number;
  }>;
  consoles: Array<{
    id: string;
    console_number: string;
    console_type: ConsoleType;
    sessions: number;
    played_minutes: number;
    revenue: number;
    utilization_percent: number;
  }>;
  payment_methods: Array<{ payment_method: PaymentMethod; count: number; amount: number }>;
}

export interface Quote {
  console_id: string;
  console_number: string;
  console_type: ConsoleType;
  hourly_rate: number;
  duration_minutes: number;
  /** Minutes a selected membership would cover. */
  membership_minutes: number;
  estimated_amount: number;
  available: boolean;
  message: string | null;
}

export interface EndPreview {
  session_id: string;
  actual_end_datetime: string;
  duration_minutes: number;
  membership_minutes: number;
  final_amount: number;
  hourly_rate: number;
}

export interface MembershipPlan {
  id: string;
  name: string;
  price: number;
  /** Included play time in minutes. */
  minutes: number;
  /** null = any console */
  console_type: ConsoleType | null;
  validity_days: number;
  is_active: boolean;
}

export type MembershipState = 'ACTIVE' | 'USED_UP' | 'EXPIRED' | 'CANCELLED';

export interface Membership {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  plan_id: string | null;
  plan_name: string;
  console_type: ConsoleType | null;
  minutes_total: number;
  minutes_used: number;
  minutes_left: number;
  price: number;
  purchased_at: string;
  expires_at: string;
  state: MembershipState;
  invoice_id: string | null;
  invoice_number: string | null;
  payment_status: PaymentStatus | null;
}