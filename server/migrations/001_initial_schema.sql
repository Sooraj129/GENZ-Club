-- Game Center Management System — initial schema
-- Requires PostgreSQL 14+ (Supabase compatible).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Enumerated domains (CHECK constraints keep the schema portable and easy to
-- extend without ALTER TYPE gymnastics).
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
  email          VARCHAR(255) NOT NULL,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(10) NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'STAFF')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
  phone       VARCHAR(15) NOT NULL UNIQUE CHECK (phone ~ '^[0-9]{10}$'),
  email       VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers (lower(name));

CREATE TABLE pricing (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  console_type  VARCHAR(10) NOT NULL UNIQUE CHECK (console_type IN ('PS4', 'PS5')),
  hourly_rate   NUMERIC(10, 2) NOT NULL CHECK (hourly_rate > 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- hourly_rate on a console is an optional override; when NULL the console uses
-- the pricing table rate for its type. The effective rate is copied onto each
-- session at booking time, so later price changes never alter old sessions.
CREATE TABLE consoles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  console_number  VARCHAR(20) NOT NULL UNIQUE CHECK (length(trim(console_number)) > 0),
  console_type    VARCHAR(10) NOT NULL REFERENCES pricing (console_type) ON UPDATE CASCADE,
  hourly_rate     NUMERIC(10, 2) CHECK (hourly_rate IS NULL OR hourly_rate > 0),
  status          VARCHAR(15) NOT NULL DEFAULT 'AVAILABLE'
                  CHECK (status IN ('AVAILABLE', 'RESERVED', 'PLAYING', 'MAINTENANCE', 'DISABLED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  console_id           UUID NOT NULL REFERENCES consoles (id) ON DELETE RESTRICT,
  start_datetime       TIMESTAMPTZ NOT NULL,
  end_datetime         TIMESTAMPTZ NOT NULL,
  actual_end_datetime  TIMESTAMPTZ,
  duration_minutes     INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  hourly_rate          NUMERIC(10, 2) NOT NULL CHECK (hourly_rate > 0),
  estimated_amount     NUMERIC(10, 2) NOT NULL CHECK (estimated_amount >= 0),
  final_amount         NUMERIC(10, 2) CHECK (final_amount IS NULL OR final_amount >= 0),
  status               VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED'
                       CHECK (status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  created_by           UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sessions_end_after_start CHECK (end_datetime > start_datetime),
  CONSTRAINT sessions_actual_end_valid CHECK (actual_end_datetime IS NULL OR actual_end_datetime >= start_datetime),
  CONSTRAINT sessions_finished_fields CHECK (
    status NOT IN ('COMPLETED', 'EXPIRED')
    OR (actual_end_datetime IS NOT NULL AND duration_minutes IS NOT NULL AND final_amount IS NOT NULL)
  ),
  -- The database itself refuses overlapping live bookings on the same console,
  -- even if two requests race past the application-level check.
  CONSTRAINT sessions_no_overlap EXCLUDE USING gist (
    console_id WITH =,
    tstzrange(start_datetime, end_datetime, '[)') WITH &&
  ) WHERE (status IN ('SCHEDULED', 'ACTIVE'))
);
CREATE INDEX sessions_status_end_idx ON sessions (status, end_datetime);
CREATE INDEX sessions_status_start_idx ON sessions (status, start_datetime);
CREATE INDEX sessions_customer_idx ON sessions (customer_id, start_datetime DESC);
CREATE INDEX sessions_console_idx ON sessions (console_id, start_datetime DESC);
CREATE INDEX sessions_start_idx ON sessions (start_datetime DESC);

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  VARCHAR(30) NOT NULL UNIQUE,
  session_id      UUID NOT NULL UNIQUE REFERENCES sessions (id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  subtotal        NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
  discount        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax             NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total           NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
  payment_status  VARCHAR(15) NOT NULL DEFAULT 'PENDING'
                  CHECK (payment_status IN ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoices_discount_le_subtotal CHECK (discount <= subtotal)
);
CREATE INDEX invoices_created_idx ON invoices (created_at DESC);
CREATE INDEX invoices_customer_idx ON invoices (customer_id);
CREATE INDEX invoices_payment_status_idx ON invoices (payment_status);

-- Per-day counter backing GC-YYYYMMDD-NNNN invoice numbers (atomic upsert).
CREATE TABLE invoice_counters (
  business_date  DATE PRIMARY KEY,
  last_value     INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  amount           NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  payment_method   VARCHAR(10) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
  reference        VARCHAR(100),
  idempotency_key  VARCHAR(100) UNIQUE,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_paid_at_idx ON payments (paid_at DESC);

-- Key/value business settings (tax, business name, reservation window...).
CREATE TABLE settings (
  key         VARCHAR(50) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO pricing (console_type, hourly_rate) VALUES ('PS4', 120.00), ('PS5', 140.00);

INSERT INTO settings (key, value) VALUES
  ('business_name', 'Game Center'),
  ('business_address', ''),
  ('business_phone', ''),
  ('tax_percent', '0'),
  ('reservation_window_minutes', '15');
