/**
 * BillingService — the single place where money is calculated.
 *
 * All arithmetic happens in integer paise to avoid floating point drift, and
 * results are converted back to rupees with two decimals.
 *
 *   amount = (duration_minutes / 60) × hourly_rate
 */
import { minutesBetween } from '../utils/time.js';

const toPaise = (rupees: number) => Math.round(rupees * 100);
const toRupees = (paise: number) => paise / 100;

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export const BillingService = {
  /** Charge for `durationMinutes` at `hourlyRate` rupees/hour. */
  calculateAmount(durationMinutes: number, hourlyRate: number): number {
    if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
      throw new Error('Duration must be a non-negative number of minutes');
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      throw new Error('Hourly rate must be positive');
    }
    return toRupees(Math.round((durationMinutes * toPaise(hourlyRate)) / 60));
  },

  /** Billable minutes between two instants (rounded to the nearest minute). */
  durationMinutes(start: Date, end: Date): number {
    return minutesBetween(start, end);
  },

  /** Estimate for a booked slot. */
  estimate(start: Date, end: Date, hourlyRate: number) {
    const durationMinutes = this.durationMinutes(start, end);
    return { durationMinutes, amount: this.calculateAmount(durationMinutes, hourlyRate) };
  },

  /**
   * Final charge when a session finishes.
   *
   * The current play segment is billed from `segmentStart` to the moment it
   * actually ended — never past its booked end, so a late background check
   * can't overcharge. Minutes from earlier segments (before a pause) are added
   * via `playedBefore`.
   */
  finalCharge(segmentStart: Date, bookedEnd: Date, actualEnd: Date, hourlyRate: number, playedBefore = 0) {
    const effectiveEnd = actualEnd.getTime() < bookedEnd.getTime() ? actualEnd : bookedEnd;
    const durationMinutes = playedBefore + this.durationMinutes(segmentStart, effectiveEnd);
    return {
      actualEnd: effectiveEnd,
      durationMinutes,
      amount: this.calculateAmount(durationMinutes, hourlyRate),
    };
  },

  /**
   * Splits played minutes between a membership balance and paid time.
   * The membership covers as much as it can; only the rest is charged.
   */
  applyMembership(durationMinutes: number, membershipMinutesLeft: number, hourlyRate: number) {
    const covered = Math.max(0, Math.min(durationMinutes, membershipMinutesLeft));
    const billable = durationMinutes - covered;
    return { covered, billable, amount: this.calculateAmount(billable, hourlyRate) };
  },

  /** subtotal − discount, then tax on the discounted amount. */
  invoiceTotals(subtotal: number, discount: number, taxPercent: number): InvoiceTotals {
    const sub = toPaise(subtotal);
    const disc = toPaise(discount);
    if (disc < 0 || disc > sub) throw new Error('Discount must be between 0 and the subtotal');
    if (taxPercent < 0) throw new Error('Tax percent cannot be negative');
    const taxable = sub - disc;
    const tax = Math.round((taxable * taxPercent) / 100);
    return {
      subtotal: toRupees(sub),
      discount: toRupees(disc),
      tax: toRupees(tax),
      total: toRupees(taxable + tax),
    };
  },

  /** Remaining balance on an invoice given what has been paid. */
  balance(total: number, paid: number): number {
    return toRupees(Math.max(0, toPaise(total) - toPaise(paid)));
  },

  /** Payment status implied by the amount paid so far. */
  paymentStatus(total: number, paid: number): 'PENDING' | 'PARTIALLY_PAID' | 'PAID' {
    const p = toPaise(paid);
    if (p <= 0) return toPaise(total) === 0 ? 'PAID' : 'PENDING';
    return p >= toPaise(total) ? 'PAID' : 'PARTIALLY_PAID';
  },
};
