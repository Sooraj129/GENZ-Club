/**
 * Session lifecycle — every rule about booking, starting, pausing, ending and
 * billing a gaming session lives here.
 *
 *   SCHEDULED ──start──▶ ACTIVE ──pause──▶ PAUSED ──resume──▶ ACTIVE ...
 *       │                  │                  │
 *    cancel             end / time up       end
 *       ▼                  ▼                  ▼
 *   CANCELLED      COMPLETED / EXPIRED   COMPLETED   → invoice
 *
 * Time model (see migration 003):
 *   booked_minutes          total play time booked (grows with Extend)
 *   played_minutes          minutes played in earlier segments (before pauses)
 *   segment_start_datetime  start of the current play segment
 *   end_datetime            end of the current segment = segment start + remaining
 *
 * Concurrency: every write locks console row(s) first, then the session row,
 * then (if needed) the membership row — always in that order.
 */
import type pg from 'pg';
import { withTransaction } from '../config/db.js';
import { consoleRepository } from '../repositories/consoleRepository.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { membershipRepository } from '../repositories/membershipRepository.js';
import { sessionRepository, type SessionFilters } from '../repositories/sessionRepository.js';
import { EventBatch } from '../sockets/index.js';
import type { AuthUser, GameConsole, Membership, Session, SessionStatus } from '../types/index.js';
import { badRequest, conflict, isPgError, notFound, PG } from '../utils/errors.js';
import { minutesBetween, now } from '../utils/time.js';
import { BillingService } from './billingService.js';
import { invoiceService } from './invoiceService.js';
import { membershipService } from './membershipService.js';
import { settingsService } from './settingsService.js';

export const SESSION_RULES = {
  MIN_MINUTES: 15,
  MAX_MINUTES: 24 * 60,
  /** How far back a session may be back-dated (for recording play that already happened). */
  MAX_BACKDATE_MINUTES: 24 * 60,
};

const MINUTE = 60_000;

// ----------------------------------------------------------------- helpers

const bookedMessage = (c: Pick<GameConsole, 'console_number'>) =>
  `${c.console_number} is already booked during the selected time.`;

function assertBookable(c: GameConsole) {
  if (c.status === 'MAINTENANCE') throw badRequest(`${c.console_number} is under maintenance and cannot be booked.`);
  if (c.status === 'DISABLED') throw badRequest(`${c.console_number} is disabled and cannot be booked.`);
}

function assertWindow(start: Date, end: Date) {
  if (end.getTime() <= start.getTime()) throw badRequest('End time must be after start time.');
  const minutes = BillingService.durationMinutes(start, end);
  if (minutes < SESSION_RULES.MIN_MINUTES) throw badRequest(`Sessions must be at least ${SESSION_RULES.MIN_MINUTES} minutes.`);
  if (minutes > SESSION_RULES.MAX_MINUTES) throw badRequest('Sessions cannot be longer than 24 hours.');
}

/** Translates the database's overlap constraint into the friendly booking error. */
async function guardOverlap<T>(c: GameConsole, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPgError(err, PG.EXCLUSION_VIOLATION)) throw conflict(bookedMessage(c));
    throw err;
  }
}

/**
 * Locks the session's console(s) then the session. Consoles are locked in id
 * order so two operations touching the same consoles can't deadlock.
 * `extraConsoleId` is for Resume onto a different console.
 */
async function lockSession(id: string, client: pg.PoolClient, extraConsoleId?: string) {
  const peek = await sessionRepository.findView(id, client);
  if (!peek) throw notFound('Session not found');
  const consoleIds = [...new Set([peek.console_id, extraConsoleId].filter(Boolean) as string[])].sort();
  const consoles = new Map<string, GameConsole>();
  for (const cid of consoleIds) {
    const c = await consoleRepository.lockById(cid, client);
    if (!c) throw notFound('Console not found');
    consoles.set(cid, c);
  }
  const session = await sessionRepository.lockById(id, client);
  if (!session) throw notFound('Session not found');
  return { session, console: consoles.get(session.console_id)!, consoles };
}

async function syncConsole(consoleId: string, client: pg.PoolClient, events: EventBatch) {
  const { reservation_window_minutes } = await settingsService.get(client);
  const changed = await consoleRepository.syncStatus(consoleId, now(), reservation_window_minutes, client);
  if (changed) events.add('console:updated', { console_id: consoleId, status: changed });
}

/** Minutes played so far (earlier segments + the running one, capped at its booked end). */
function playedUntil(session: Session, at: Date): number {
  if (session.status !== 'ACTIVE') return session.played_minutes;
  const segmentEnd = at.getTime() < session.end_datetime.getTime() ? at : session.end_datetime;
  return session.played_minutes + minutesBetween(session.segment_start_datetime, segmentEnd);
}

/**
 * Membership minutes usable when settling this session. A session that started
 * while the membership was valid may finish on it even if it expires mid-play.
 */
function membershipMinutesFor(m: Membership | null, session: Pick<Session, 'start_datetime'>): number {
  if (!m || m.status !== 'ACTIVE' || m.expires_at.getTime() <= session.start_datetime.getTime()) return 0;
  return Math.max(0, m.minutes_total - m.minutes_used);
}

/** Estimate for `bookedMinutes`, after whatever the membership can cover. */
function estimateAmount(bookedMinutes: number, hourlyRate: number, membershipMinutesLeft: number) {
  return BillingService.applyMembership(bookedMinutes, membershipMinutesLeft, hourlyRate).amount;
}

async function membershipLeft(session: Pick<Session, 'membership_id' | 'start_datetime'>, client?: pg.PoolClient) {
  if (!session.membership_id) return 0;
  return membershipMinutesFor(await membershipRepository.findById(session.membership_id, client), session);
}

// ----------------------------------------------------------------- service

export const sessionService = {
  /** Estimate shown on the New Session form, calculated by the server's BillingService. */
  async quote(consoleId: string, start: Date, end: Date, membershipId?: string) {
    const c = await consoleRepository.findById(consoleId);
    if (!c) throw notFound('Console not found');
    assertWindow(start, end);
    const durationMinutes = BillingService.durationMinutes(start, end);
    const left = membershipId ? membershipMinutesFor(await membershipRepository.findById(membershipId), { start_datetime: start }) : 0;
    const split = BillingService.applyMembership(durationMinutes, left, c.hourly_rate);
    const overlap = await sessionRepository.findOverlap(consoleId, start, end, null);
    return {
      console_id: c.id,
      console_number: c.console_number,
      console_type: c.console_type,
      hourly_rate: c.hourly_rate,
      duration_minutes: durationMinutes,
      membership_minutes: split.covered,
      estimated_amount: split.amount,
      available: !overlap && c.status !== 'MAINTENANCE' && c.status !== 'DISABLED',
      message: overlap
        ? bookedMessage(c)
        : c.status === 'MAINTENANCE' || c.status === 'DISABLED'
          ? `${c.console_number} is ${c.status.toLowerCase()} and cannot be booked.`
          : null,
    };
  },

  async create(
    input: { customer_id: string; console_id: string; start: Date; end: Date; membership_id?: string | null },
    user: AuthUser,
  ) {
    assertWindow(input.start, input.end);
    const at = now();
    if (at.getTime() - input.start.getTime() > SESSION_RULES.MAX_BACKDATE_MINUTES * MINUTE) {
      throw badRequest('Start time cannot be more than 24 hours in the past.');
    }

    const events = new EventBatch();
    const session = await withTransaction(async (client) => {
      const customer = await customerRepository.findById(input.customer_id, client);
      if (!customer) throw notFound('Customer not found');

      // Row lock serializes every booking for this console; the exclusion
      // constraint is the final guarantee if anything slips past.
      const c = await consoleRepository.lockById(input.console_id, client);
      if (!c) throw notFound('Console not found');
      assertBookable(c);

      const left = input.membership_id
        ? await membershipService.assertUsable(input.membership_id, customer.id, c.console_type, client)
        : 0;

      if (await sessionRepository.findOverlap(c.id, input.start, input.end, null, client)) {
        throw conflict(bookedMessage(c));
      }

      const bookedMinutes = BillingService.durationMinutes(input.start, input.end);
      const status: SessionStatus = input.start.getTime() <= at.getTime() ? 'ACTIVE' : 'SCHEDULED';
      const created = await guardOverlap(c, () =>
        sessionRepository.insert(
          {
            customer_id: customer.id,
            console_id: c.id,
            start_datetime: input.start,
            end_datetime: input.end,
            booked_minutes: bookedMinutes,
            hourly_rate: c.hourly_rate,
            estimated_amount: estimateAmount(bookedMinutes, c.hourly_rate, left),
            status,
            membership_id: input.membership_id ?? null,
            created_by: user.id,
          },
          client,
        ),
      );
      events.add('session:created', { session_id: created.id });
      if (status === 'ACTIVE') events.add('session:started', { session_id: created.id });
      await syncConsole(c.id, client, events);
      events.add('dashboard:updated');
      return created;
    });
    events.flush();

    // A booking whose end time has already passed is settled straight away.
    if (session.status === 'ACTIVE' && session.end_datetime.getTime() <= now().getTime()) {
      await this.expire(session.id);
    }
    return this.get(session.id);
  },

  async get(id: string) {
    const session = await sessionRepository.findView(id);
    if (!session) throw notFound('Session not found');
    return session;
  },

  list(filters: SessionFilters, page: number, pageSize: number) {
    return sessionRepository.list(filters, pageSize, (page - 1) * pageSize);
  },

  listActive() {
    return sessionRepository.listActive();
  },

  listPaused() {
    return sessionRepository.listPaused();
  },

  listUpcoming() {
    return sessionRepository.listUpcoming(20);
  },

  /** Starts a scheduled session now (customer arrived early, or ahead of the monitor tick). */
  async start(id: string) {
    const events = new EventBatch();
    await withTransaction(async (client) => {
      const { console: c, session } = await lockSession(id, client);
      if (session.status !== 'SCHEDULED') throw badRequest(`Only scheduled sessions can be started (this one is ${session.status}).`);
      assertBookable(c);

      const at = now();
      const fields: Partial<Session> = { status: 'ACTIVE' };
      if (at.getTime() < session.start_datetime.getTime()) {
        // Starting early: the slot moves to begin now, so re-check the gap before it.
        if (await sessionRepository.findOverlap(c.id, at, session.end_datetime, session.id, client)) {
          throw conflict(`${c.console_number} is booked by another session before this one starts.`);
        }
        assertWindow(at, session.end_datetime);
        const bookedMinutes = BillingService.durationMinutes(at, session.end_datetime);
        fields.start_datetime = at;
        fields.segment_start_datetime = at;
        fields.booked_minutes = bookedMinutes;
        fields.estimated_amount = estimateAmount(bookedMinutes, session.hourly_rate, await membershipLeft(session, client));
      }
      await guardOverlap(c, () => sessionRepository.update(id, fields, client));
      events.add('session:started', { session_id: id });
      await syncConsole(c.id, client, events);
      events.add('dashboard:updated');
    });
    events.flush();
    return this.get(id);
  },

  /**
   * Pause ("stop") — the customer steps away and will continue later.
   * The clock and billing stop, minutes played so far are saved, and the
   * console is freed for other customers. Resume picks up the remaining time.
   */
  async pause(id: string) {
    const events = new EventBatch();
    await withTransaction(async (client) => {
      const { session } = await lockSession(id, client);
      if (session.status !== 'ACTIVE') throw badRequest(`Only sessions that are playing can be paused (this one is ${session.status}).`);

      const at = now();
      const played = playedUntil(session, at);
      if (played >= session.booked_minutes) {
        // Nothing left to pause for — just finish it.
        await this.finalize(session, at, 'COMPLETED', client, events);
        return;
      }
      await sessionRepository.update(
        id,
        { status: 'PAUSED', played_minutes: played, paused_at: at, pause_count: session.pause_count + 1 },
        client,
      );
      events.add('session:paused', { session_id: id, played_minutes: played });
      events.add('session:updated', { session_id: id });
      await syncConsole(session.console_id, client, events);
      events.add('dashboard:updated');
    });
    events.flush();
    return this.get(id);
  },

  /**
   * Resume a paused session for its remaining minutes, starting now, on the
   * same console or (optionally) another free console of the same type.
   */
  async resume(id: string, targetConsoleId?: string) {
    const events = new EventBatch();
    await withTransaction(async (client) => {
      const { session, consoles } = await lockSession(id, client, targetConsoleId);
      if (session.status !== 'PAUSED') throw badRequest(`Only paused sessions can be resumed (this one is ${session.status}).`);

      const previous = consoles.get(session.console_id)!;
      const target = consoles.get(targetConsoleId ?? session.console_id)!;
      if (target.console_type !== previous.console_type) {
        throw badRequest(`Resume on a ${previous.console_type} console — this session was booked at the ${previous.console_type} rate.`);
      }
      assertBookable(target);

      const remaining = session.booked_minutes - session.played_minutes;
      if (remaining <= 0) throw badRequest('No time left on this session — end it instead.');

      const start = now();
      const end = new Date(start.getTime() + remaining * MINUTE);
      if (await sessionRepository.findOverlap(target.id, start, end, session.id, client)) {
        throw conflict(`${target.console_number} is not free for the remaining ${remaining} minutes. Choose another console or extend later.`);
      }
      await guardOverlap(target, () =>
        sessionRepository.update(
          id,
          { status: 'ACTIVE', console_id: target.id, segment_start_datetime: start, end_datetime: end, paused_at: null },
          client,
        ),
      );
      events.add('session:resumed', { session_id: id, console_id: target.id });
      events.add('session:updated', { session_id: id });
      await syncConsole(target.id, client, events);
      if (target.id !== previous.id) await syncConsole(previous.id, client, events);
      events.add('dashboard:updated');
    });
    events.flush();
    return this.get(id);
  },

  /** Server-side preview for the "End this gaming session?" confirmation. */
  async endPreview(id: string) {
    const session = await this.get(id);
    if (session.status !== 'ACTIVE' && session.status !== 'PAUSED') throw badRequest('Only playing or paused sessions can be ended.');
    const duration = playedUntil(session, now());
    const split = BillingService.applyMembership(duration, await membershipLeft(session), session.hourly_rate);
    return {
      session_id: id,
      actual_end_datetime: session.status === 'PAUSED' ? session.paused_at : now(),
      duration_minutes: duration,
      membership_minutes: split.covered,
      final_amount: split.amount,
      hourly_rate: session.hourly_rate,
    };
  },

  /** Staff ends a playing or paused session (customer leaving). */
  async end(id: string) {
    const events = new EventBatch();
    await withTransaction(async (client) => {
      const { session } = await lockSession(id, client);
      if (session.status !== 'ACTIVE' && session.status !== 'PAUSED') {
        throw badRequest(`Only playing or paused sessions can be ended (this one is ${session.status}).`);
      }
      await this.finalize(session, now(), 'COMPLETED', client, events);
    });
    events.flush();
    return this.get(id);
  },

  /**
   * Background expiry of one session. Safe to call repeatedly or concurrently:
   * it re-checks status under the row lock and does nothing if the session was
   * already settled. Returns true when this call settled it.
   */
  async expire(id: string): Promise<boolean> {
    const events = new EventBatch();
    const done = await withTransaction(async (client) => {
      const { session } = await lockSession(id, client);
      if (session.status !== 'ACTIVE') return false;
      if (session.end_datetime.getTime() > now().getTime()) return false;
      await this.finalize(session, session.end_datetime, 'EXPIRED', client, events);
      return true;
    });
    events.flush();
    return done;
  },

  /** Activates a scheduled session whose start time has arrived. Idempotent. */
  async activateDue(id: string): Promise<boolean> {
    const events = new EventBatch();
    const done = await withTransaction(async (client) => {
      const { console: c, session } = await lockSession(id, client);
      if (session.status !== 'SCHEDULED' || session.start_datetime.getTime() > now().getTime()) return false;
      await sessionRepository.update(id, { status: 'ACTIVE' }, client);
      events.add('session:started', { session_id: id });
      await syncConsole(c.id, client, events);
      events.add('dashboard:updated');
      return true;
    });
    events.flush();
    return done;
  },

  /**
   * Shared settlement: total play time → membership minutes used first →
   * remaining minutes billed → session closed → invoice → console freed.
   */
  async finalize(
    session: Session,
    actualEnd: Date,
    status: 'COMPLETED' | 'EXPIRED',
    client: pg.PoolClient,
    events: EventBatch,
  ) {
    // 1. How long did they play in total?
    const played =
      session.status === 'PAUSED'
        ? { actualEnd: session.paused_at!, durationMinutes: session.played_minutes }
        : BillingService.finalCharge(session.segment_start_datetime, session.end_datetime, actualEnd, session.hourly_rate, session.played_minutes);

    // 2. Use membership minutes first (row-locked so two sessions can't overspend).
    let covered = 0;
    if (session.membership_id) {
      const membership = await membershipRepository.lockById(session.membership_id, client);
      covered = BillingService.applyMembership(played.durationMinutes, membershipMinutesFor(membership, session), session.hourly_rate).covered;
      if (covered > 0) {
        await membershipRepository.addMinutesUsed(session.membership_id, covered, client);
        events.add('membership:updated', { membership_id: session.membership_id, customer_id: session.customer_id });
      }
    }

    // 3. Bill whatever the membership didn't cover.
    const amount = BillingService.calculateAmount(played.durationMinutes - covered, session.hourly_rate);
    const settled = await sessionRepository.update(
      session.id,
      {
        status,
        actual_end_datetime: played.actualEnd,
        duration_minutes: played.durationMinutes,
        membership_minutes: session.membership_id ? covered : null,
        final_amount: amount,
        paused_at: null,
      },
      client,
    );

    // 4. Invoice (idempotent) and free the console.
    const { invoice, created } = await invoiceService.createForSession(settled, client);
    events.add(status === 'EXPIRED' ? 'session:expired' : 'session:completed', {
      session_id: session.id,
      invoice_id: invoice.id,
    });
    if (created) events.add('invoice:created', { invoice_id: invoice.id, invoice_number: invoice.invoice_number });
    await syncConsole(session.console_id, client, events);
    events.add('dashboard:updated');
  },

  /**
   * Adds `minutes` to a scheduled, playing or paused session.
   * Playing/scheduled: the console must be free for the extra time.
   * Paused: only the booked total grows; availability is checked on Resume.
   */
  async extend(id: string, minutes: number) {
    const events = new EventBatch();
    await withTransaction(async (client) => {
      const { console: c, session } = await lockSession(id, client);
      if (!['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(session.status)) {
        throw badRequest(`Only scheduled, playing or paused sessions can be extended (this one is ${session.status}).`);
      }
      const bookedMinutes = session.booked_minutes + minutes;
      if (bookedMinutes > SESSION_RULES.MAX_MINUTES) throw badRequest('Sessions cannot be longer than 24 hours.');

      const fields: Partial<Session> = {
        booked_minutes: bookedMinutes,
        estimated_amount: estimateAmount(bookedMinutes, session.hourly_rate, await membershipLeft(session, client)),
      };
      if (session.status !== 'PAUSED') {
        const newEnd = new Date(session.end_datetime.getTime() + minutes * MINUTE);
        const clash = await sessionRepository.findOverlap(c.id, session.end_datetime, newEnd, session.id, client);
        if (clash) throw conflict(`${c.console_number} is booked by another session in the extended time.`);
        fields.end_datetime = newEnd;
      }
      await guardOverlap(c, () => sessionRepository.update(id, fields, client));
      events.add('session:extended', { session_id: id, end_datetime: fields.end_datetime ?? session.end_datetime });
      events.add('session:updated', { session_id: id });
      events.add('dashboard:updated');
    });
    events.flush();
    return this.get(id);
  },

  /** Cancels a session that has not started. */
  async cancel(id: string) {
    const events = new EventBatch();
    await withTransaction(async (client) => {
      const { console: c, session } = await lockSession(id, client);
      if (session.status !== 'SCHEDULED') {
        throw badRequest(
          session.status === 'ACTIVE' || session.status === 'PAUSED'
            ? 'This session has already started — use End Session instead.'
            : `This session is already ${session.status.toLowerCase()}.`,
        );
      }
      await sessionRepository.update(id, { status: 'CANCELLED' }, client);
      events.add('session:cancelled', { session_id: id });
      events.add('session:updated', { session_id: id });
      await syncConsole(c.id, client, events);
      events.add('dashboard:updated');
    });
    events.flush();
    return this.get(id);
  },
};
