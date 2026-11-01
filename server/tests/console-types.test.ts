import { beforeAll, describe, expect, it } from 'vitest';
import { consoleService } from '../src/services/consoleService.js';
import { reportService } from '../src/services/reportService.js';
import { sessionService } from '../src/services/sessionService.js';
import { settingsService } from '../src/services/settingsService.js';
import type { AuthUser } from '../src/types/index.js';
import { businessDate } from '../src/utils/time.js';
import { createCustomer, createUser, minutesFromNow } from './helpers.js';

let staff: AuthUser;
let customer: { id: string };

beforeAll(async () => {
  staff = await createUser('STAFF');
  customer = await createCustomer('Racer');
});

describe('steering wheel and VR stations', () => {
  it('has prices for every console type, listed PS5, PS4, Steering Wheel, VR', async () => {
    const pricing = await settingsService.listPricing();
    expect(pricing.map((p) => p.console_type)).toEqual(['PS5', 'PS4', 'STEERING', 'VR']);
    expect(pricing.find((p) => p.console_type === 'STEERING')?.label).toBe('Steering Wheel');
  });

  it('can add steering and VR consoles and bill them at their own rate', async () => {
    await settingsService.updatePricing('STEERING', 180);
    await settingsService.updatePricing('VR', 240);
    const wheel = await consoleService.create({ console_number: 'STEER-T1', console_type: 'STEERING', hourly_rate: null, status: 'AVAILABLE' });
    const vr = await consoleService.create({ console_number: 'VR-T1', console_type: 'VR', hourly_rate: null, status: 'AVAILABLE' });
    expect(wheel.hourly_rate).toBe(180);
    expect(vr.hourly_rate).toBe(240);

    // 30 min of VR at ₹240/hr = ₹120; 60 min on the wheel at ₹180/hr = ₹180 (both already finished → invoiced).
    const v = await sessionService.create({ customer_id: customer.id, console_id: vr.id, start: minutesFromNow(-90), end: minutesFromNow(-60) }, staff);
    const w = await sessionService.create({ customer_id: customer.id, console_id: wheel.id, start: minutesFromNow(-120), end: minutesFromNow(-60) }, staff);
    expect(v.final_amount).toBe(120);
    expect(w.final_amount).toBe(180);

    const today = businessDate();
    const r = await reportService.report(today, today, 'day');
    expect(r.summary.by_type.VR).toBeGreaterThanOrEqual(120);
    expect(r.summary.by_type.STEERING).toBeGreaterThanOrEqual(180);
    expect(Object.keys(r.series[0].by_type).sort()).toEqual(['PS4', 'PS5', 'STEERING', 'VR']);
  });

  it('rejects unknown console types', async () => {
    await expect(
      consoleService.create({ console_number: 'XB-01', console_type: 'XBOX' as never, hourly_rate: null, status: 'AVAILABLE' }),
    ).rejects.toThrow();
  });
});
