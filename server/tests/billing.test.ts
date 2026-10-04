import { describe, expect, it } from 'vitest';
import { BillingService } from '../src/services/billingService.js';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 3, h, m));

describe('BillingService.calculateAmount', () => {
  it.each([
    ['PS4', 30, 120, 60],
    ['PS4', 60, 120, 120],
    ['PS4', 90, 120, 180],
    ['PS4', 120, 120, 240],
    ['PS5', 30, 140, 70],
    ['PS5', 60, 140, 140],
    ['PS5', 90, 140, 210],
    ['PS5', 120, 140, 280],
  ])('%s %i min at ₹%i/hr = ₹%i', (_type, minutes, rate, expected) => {
    expect(BillingService.calculateAmount(minutes, rate)).toBe(expected);
  });

  it('bills partial hours by the minute (1h15m on PS5 = ₹175)', () => {
    expect(BillingService.calculateAmount(75, 140)).toBe(175);
  });

  it('keeps paise precision without float drift', () => {
    expect(BillingService.calculateAmount(76, 140)).toBe(177.33);
    expect(BillingService.calculateAmount(1, 150)).toBe(2.5);
  });

  it('rejects invalid input', () => {
    expect(() => BillingService.calculateAmount(-1, 140)).toThrow();
    expect(() => BillingService.calculateAmount(60, 0)).toThrow();
  });
});

describe('BillingService.finalCharge', () => {
  it('charges actual play time when a customer leaves early', () => {
    const r = BillingService.finalCharge(at(12), at(14), at(13, 15), 140);
    expect(r.durationMinutes).toBe(75);
    expect(r.amount).toBe(175);
  });

  it('never charges past the booked end, even if expiry is detected late', () => {
    const r = BillingService.finalCharge(at(12), at(13), at(13, 4), 140);
    expect(r.durationMinutes).toBe(60);
    expect(r.amount).toBe(140);
    expect(r.actualEnd).toEqual(at(13));
  });
});

describe('BillingService.invoiceTotals & payment status', () => {
  it('applies discount then tax', () => {
    expect(BillingService.invoiceTotals(280, 30, 18)).toEqual({ subtotal: 280, discount: 30, tax: 45, total: 295 });
  });

  it('defaults to no tax', () => {
    expect(BillingService.invoiceTotals(280, 0, 0)).toEqual({ subtotal: 280, discount: 0, tax: 0, total: 280 });
  });

  it('rejects a discount larger than the subtotal', () => {
    expect(() => BillingService.invoiceTotals(100, 101, 0)).toThrow();
  });

  it('derives payment status from amount paid', () => {
    expect(BillingService.paymentStatus(280, 0)).toBe('PENDING');
    expect(BillingService.paymentStatus(280, 100)).toBe('PARTIALLY_PAID');
    expect(BillingService.paymentStatus(280, 280)).toBe('PAID');
    expect(BillingService.balance(280, 100)).toBe(180);
  });
});
