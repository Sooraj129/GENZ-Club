# Game Center Management System

A real-time POS and session manager for PlayStation gaming centers. Staff use it to look up customers, book PS4/PS5 consoles without double-booking, and watch live session timers. Sessions end automatically on the server, which generates the invoice; staff then collect cash, UPI, or card payments and review reports.

```
React + TypeScript (Vite, Tailwind, TanStack Query, Socket.IO client)
        │  REST /api  +  WebSocket /socket.io
        ▼
Node.js + Express + Socket.IO        ← BillingService, SessionService, session monitor job
        │  pg (parameterized SQL, transactions, row locks)
        ▼
Supabase PostgreSQL                  ← exclusion constraint prevents overlapping bookings
```

## Quick start

Requirements: Node 20+ and a Supabase project (or any PostgreSQL 14+).

```bash
# 1. Backend
cd server
npm install
cp .env.example .env          # fill in DATABASE_URL and JWT_SECRET (see below)
npm run migrate               # creates tables, constraints, indexes; locks down the Supabase Data API
npm run seed                  # demo users, customers, 3×PS5 + 1×PS4, 2 weeks of history
                              # (npm run seed -- --reset wipes customers/consoles/sessions/invoices first)
                              # (npm run seed -- --minimal = only logins + consoles, no demo data — for a real start)
npm run dev                   # http://localhost:5000

# 2. Frontend (new terminal)
cd client
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:5000
npm run dev                   # http://localhost:5173 — calls the API directly on :5000
```

Demo logins created by the seed. **Change these passwords on the Users page before going live:**

| Role  | Email                    | Password     |
|-------|--------------------------|--------------|
| Admin | admin@gamecenter.local   | Admin@1234   |
| Staff | staff@gamecenter.local   | Staff@1234   |

### Environment

`server/.env` holds the secrets. It is git-ignored and is **never** exposed to the frontend.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → connection string (URI). URL-encode special characters in the password (`!`→`%21`, `@`→`%40`, `#`→`%23`, `$`→`%24`). |
| `DATABASE_SSL` | `true` for Supabase. |
| `JWT_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Token lifetime, default `12h`. |
| `CLIENT_ORIGIN` | Comma-separated allowed frontend origins (CORS and Socket.IO). |
| `SESSION_MONITOR_INTERVAL_MS` | Background monitor interval, default `15000`. |

`client/.env` has a single setting, `VITE_API_URL`: the API server's own address (default `http://localhost:5000`; in production e.g. `https://api.example.com`). The web app and the API run on **separate ports**, and the browser calls the API directly for both REST and Socket.IO; there is no dev proxy. The web app's origin must be listed in the server's `CLIENT_ORIGIN`, otherwise CORS blocks the calls.

## Debugging

Every API call can be traced end to end by its **request ID**:

1. **Browser console (development):** one collapsible line per call, e.g. `[API] POST /sessions → 409 in 38ms (rid 3f9c1a2b-7d4)`. Expand it to see the request body and the response. Failed calls are logged in production too; to log everything in a production build, run `localStorage.setItem('gc_debug','1')`. Socket.IO events appear as `[socket] session:expired {...}`.
2. **Server log:** each request is logged on one line with the same ID, e.g. `← POST /api/sessions 409 38ms {"rid":"3f9c1a2b-7d4","user":"staff@…"}`. Rejections log their reason (`Rejected: PS5-01 is already booked…`), and unexpected errors log the full stack.
3. **Server errors (5xx)** show staff a short reference, e.g. `(ref 3f9c1a2b)`. Search the server log for it.

Where to look for each area:

| Area | Frontend call | Server route → controller → service |
|---|---|---|
| Login | `client/src/api/auth.ts` | `routes/index.ts` → `authController` → `authService` |
| Customers | `api/customers.ts` | `customerController` → `customerService` → `customerRepository` |
| Consoles | `api/consoles.ts` | `consoleController` → `consoleService` → `consoleRepository` |
| Sessions | `api/sessions.ts` | `sessionController` → `sessionService` (+ `billingService`) |
| Auto start/expiry | (Socket.IO events) | `jobs/sessionMonitor.ts` → `sessionService.expire/activateDue` |
| Invoices & payments | `api/billing.ts` | `billingController` → `invoiceService` / `paymentService` |
| Dashboard & reports | `api/admin.ts` | `billingController` → `reportService` |

The Supabase publishable/anon key is **not** used. The backend connects to Postgres directly. Migration `002` enables Row Level Security with no policies on every table, so the public Data API cannot read or write anything.

### Without Supabase (local Postgres in WASM)

```bash
cd server
npm run db:local   # PGlite on 127.0.0.1:54329, data stored in server/.pglite
# in server/.env:
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
#   DATABASE_SSL=false
#   DB_POOL_MAX=1
```

## How the important rules are enforced

**The server is the source of truth for time and money.**
- **Booking times:** staff enter wall-clock date and time. The server converts them using Asia/Kolkata (a fixed +05:30), and all timestamps are stored as `TIMESTAMPTZ`.
- **Browser timers are display-only:** they run on a server-aligned clock (the offset is measured via `/api/time` and a Socket.IO `time:sync`), so a wrong PC clock doesn't affect them.
- **The browser never ends a session or decides an amount:** prices, estimates and the "End session?" preview all come from the API.

**Background session monitor** ([server/src/jobs/sessionMonitor.ts](server/src/jobs/sessionMonitor.ts)) runs on boot and then every 15 s:
1. `SCHEDULED` sessions whose start time has arrived become `ACTIVE`, and the console becomes `PLAYING`.
2. `ACTIVE` sessions past their end time become `EXPIRED`, get their final bill, and get an invoice. Their console is freed.
3. Console states are re-derived. For example, a console becomes `RESERVED` when its next booking is inside the reservation window.
4. Socket.IO events are pushed, and every open screen updates without a refresh.

Every transition runs in its own transaction. It locks the console row and then the session row, and re-checks the status before acting. `invoices.session_id` is `UNIQUE`, and invoice insertion uses `ON CONFLICT DO NOTHING`. As a result, running the monitor twice (or on two servers) never completes a session twice or bills twice. Because all state is in PostgreSQL, a restarted server simply catches up on its first tick.

**No double booking:**
- The console row is locked with `SELECT … FOR UPDATE` during booking, extension and early start.
- An application-level overlap check returns a friendly message: *"PS5-01 is already booked during the selected time."*
- The database itself has `EXCLUDE USING gist (console_id WITH =, tstzrange(start, end) WITH &&) WHERE status IN ('SCHEDULED','ACTIVE')`. Even a request that bypasses the service can't create an overlap.

**Billing** ([server/src/services/billingService.ts](server/src/services/billingService.ts)) is the single place money is calculated:
- The formula is `amount = duration_minutes / 60 × hourly_rate`, computed in integer paise. Duration is rounded to the nearest minute, so PS5 for 75 min = ₹175.
- An early end bills actual play time. An automatic expiry bills to the booked end, never to when the monitor happened to notice.
- The hourly rate is copied onto each session at booking time. A later price change in Settings affects only new sessions.

**Payments:**
- The invoice row is locked while a payment is recorded. Amounts above the balance due are rejected, and a fully paid invoice cannot be paid again.
- Each payment dialog sends an idempotency key, so double-clicks and network retries return the original payment instead of charging twice.
- Partial payments move the invoice to `PARTIALLY_PAID`, then to `PAID`.

**Invoice numbers** are `GC-YYYYMMDD-NNNN`. The sequence comes from an atomic per-day counter, using the business date in IST.

## Roles

| | Staff | Admin |
|---|:-:|:-:|
| Customers, new/extend/end/cancel sessions, active sessions, history | ✓ | ✓ |
| View invoices, print or download PDF, record payments | ✓ | ✓ |
| View consoles | ✓ | ✓ |
| Add or edit consoles, maintenance status | | ✓ |
| Pricing, tax, business settings | | ✓ |
| Invoice discount or cancel, edit a payment's method or reference | | ✓ |
| Reports, users | | ✓ |

Roles are enforced on the API. The UI only hides what a role can't use.

## Session lifecycle

```
SCHEDULED ──(start time / "Start now")──▶ ACTIVE ⇄ PAUSED        (Pause / Resume, any number of times)
    │                                       │        │
    └──(cancel)──▶ CANCELLED                │        └──(End)──────────────▶ COMPLETED ─┐
                                            ├──(staff ends early)──────────▶ COMPLETED ─┼─▶ invoice ─▶ payments ─▶ PAID
                                            └──(end time passes, server)───▶ EXPIRED  ──┘
```

### Pause ("stop") and resume

- **Pause** stops the clock and billing. The minutes played so far are saved, and the console is freed so someone else can use it. A paused session is never auto-expired.
- **Resume** continues the remaining time from now, on the same console or any other free console of the same type. The server checks availability exactly as for a new booking.
- **End** on a paused session bills only the minutes actually played.
- **Extend** works while paused; only the booked total grows.

### Membership packages (e.g. "799 Package")

- **Plans** (admin, *Memberships → Plans*): name, price, included hours, PS4/PS5/any, and validity in days.
- **Selling** a plan to a customer creates a membership plus an invoice for its price. The invoice is paid like any other, and the payment dialog opens right after the sale.
- **Playing on a package:** on New Session, choose the customer's package under *Pay with*. When the session is settled, its played minutes come off the package balance first. Only minutes beyond the balance are billed at the hourly rate. With pause/resume, only minutes actually played are deducted.
- **Locking:** balances are deducted under a row lock, so two sessions on the same package can never overspend it.
- **Expiry:** packages expire after their validity. A session that started before expiry may finish on the package.
- **Cancelling:** an unused membership can be cancelled by cancelling its invoice (admin).

A booking entered with an end time already in the past (for example, recording play that already happened, up to 24 h back) is settled and invoiced immediately.

## API

All responses are `{ success: true, data, meta? }` or `{ success: false, message }`. Every route except login and health requires `Authorization: Bearer <token>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login` (rate-limited), `POST /api/auth/logout`, `GET /api/auth/me` |
| Customers | `POST/GET /api/customers`, `GET /api/customers/search?q=`, `GET/PUT /api/customers/:id`, `GET /api/customers/:id/sessions` |
| Consoles | `GET/POST /api/consoles`, `GET/PUT/DELETE /api/consoles/:id` (delete only if never booked; otherwise set `DISABLED`), `GET /api/consoles/:id/schedule?date=` |
| Sessions | `POST /api/sessions/quote`, `POST/GET /api/sessions`, `GET /api/sessions/active` (playing + paused + upcoming), `GET /api/sessions/:id`, `POST /api/sessions/:id/{start,pause,resume,end,extend,cancel}`, `GET /api/sessions/:id/end-preview` |
| Memberships | `GET/POST /api/membership-plans` (POST admin), `PUT /api/membership-plans/:id` (admin), `GET/POST /api/memberships`, `GET /api/memberships/:id`, `GET /api/customers/:id/memberships` |
| Invoices | `GET /api/invoices`, `GET /api/invoices/:id`, `GET /api/invoices/:id/pdf`, `POST /api/invoices/:id/{discount,cancel}` |
| Payments | `POST/GET /api/payments`, `PUT /api/payments/:id` |
| Dashboard / reports | `GET /api/dashboard/summary`, `GET /api/dashboard/revenue?days=`, `GET /api/reports?from=&to=&group=day\|week\|month` |
| Settings | `GET/PUT /api/settings`, `GET/PUT /api/pricing`, `GET /api/time` |

Socket.IO events (JWT required on connect): `session:created`, `session:started`, `session:updated`, `session:extended`, `session:completed`, `session:expired`, `session:cancelled`, `console:updated`, `invoice:created`, `invoice:updated`, `payment:updated`, `customer:updated`, `dashboard:updated`.

## Tests

```bash
cd server && npm test
```

There are 60 tests covering billing (PS4/PS5 at 30/60/90/120 min), booking rules, the session lifecycle, the monitor, invoices, payments, and the HTTP layer. They cover:
- **Booking:** overlap, back-to-back, maintenance, and racing bookings.
- **Session lifecycle:** create, start, end early, extend, cancel, and immediate expiry.
- **Monitor:** expiry after a "restart", idempotency, concurrent expiry, activation, and RESERVED status.
- **Invoices:** amount, number format and sequence, no duplicates, discount.
- **Payments:** Cash, UPI, Card, partial, overpay, already-paid, idempotent retry, and racing payments.
- **HTTP layer:** auth, roles, validation, duplicate phone, IST conversion, and no leaked internals.

Each test file runs against its own throwaway real PostgreSQL (PGlite over the wire protocol), so the production `pg` driver, constraints and transactions are exercised as-is.

## Production notes

- **Build:** `cd server && npm run build && npm start`, and `cd client && npm run build` (serve `client/dist` from any static host). Set `CLIENT_ORIGIN` to the frontend's URL.
- **Process:** run the API as a single long-lived process, or several. The monitor is safe to run concurrently. It is not suited to serverless functions, because the monitor and WebSockets need a persistent process.
- **Supabase connections:** the direct connection (port 5432) is used. If your network has no IPv6, use Supabase's **session pooler** connection string instead.
- **Security:** helmet secure headers, CORS allow-list, login rate limiting, bcrypt (12 rounds), Zod validation on every input, and parameterized SQL only. Errors are logged server-side, and clients receive generic messages without stack traces.

## Project layout

```
server/
  migrations/        SQL schema (tables, FKs, CHECKs, indexes, exclusion constraint, RLS)
  seed/              demo data
  scripts/           migrate, local PGlite database
  src/
    config/          env validation, pg pool + transaction helper
    controllers/     thin HTTP handlers
    services/        business logic (billing, sessions, invoices, payments, reports, PDF)
    repositories/    SQL
    jobs/            session monitor
    sockets/         Socket.IO server + post-commit event batching
    middleware/      auth/roles, error handler
    validators/      Zod schemas
    routes/, types/, utils/, app.ts
  tests/
client/
  src/
    api/             axios client + typed endpoint functions
    components/      UI kit, status badges, charts, session/payment/customer dialogs
    contexts/        auth, Socket.IO (live query invalidation, server clock sync)
    hooks/, layouts/, pages/, routes/, types/, utils/
```
