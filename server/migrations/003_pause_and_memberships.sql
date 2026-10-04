-- Pause / resume sessions, and prepaid membership packages.

-- ===========================================================================
-- 1. Pause / resume
-- ===========================================================================
-- A session can now be paused and resumed (possibly several times, possibly on
-- another console of the same type). Model:
--
--   booked_minutes          total play time the customer booked
--   played_minutes          minutes played in segments that already ended (pauses)
--   segment_start_datetime  when the current play segment started
--   end_datetime            when the current segment will end
--                           (= segment start + remaining minutes)
--   start_datetime          first start — kept for history/display
--
-- The no-overlap rule now applies to the *current segment*, so a paused
-- session doesn't block its console, and a resumed one only blocks from the
-- moment it resumed.

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_no_overlap;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

ALTER TABLE sessions ADD COLUMN segment_start_datetime TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN booked_minutes INTEGER;
UPDATE sessions SET
  segment_start_datetime = start_datetime,
  booked_minutes = GREATEST(1, round(extract(epoch FROM (end_datetime - start_datetime)) / 60)::int);
ALTER TABLE sessions ALTER COLUMN segment_start_datetime SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN booked_minutes SET NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_booked_minutes_positive CHECK (booked_minutes > 0);

ALTER TABLE sessions ADD COLUMN played_minutes INTEGER NOT NULL DEFAULT 0 CHECK (played_minutes >= 0);
ALTER TABLE sessions ADD COLUMN paused_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN pause_count INTEGER NOT NULL DEFAULT 0 CHECK (pause_count >= 0);

ALTER TABLE sessions ADD CONSTRAINT sessions_segment_valid CHECK (end_datetime > segment_start_datetime);
ALTER TABLE sessions ADD CONSTRAINT sessions_paused_fields CHECK (status <> 'PAUSED' OR paused_at IS NOT NULL);

ALTER TABLE sessions ADD CONSTRAINT sessions_no_overlap EXCLUDE USING gist (
  console_id WITH =,
  tstzrange(segment_start_datetime, end_datetime, '[)') WITH &&
) WHERE (status IN ('SCHEDULED', 'ACTIVE'));

-- ===========================================================================
-- 2. Membership packages
-- ===========================================================================

-- What can be sold, e.g. "799 Package — 6 hours, any console, valid 30 days".
CREATE TABLE membership_plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(60) NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  price          NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  minutes        INTEGER NOT NULL CHECK (minutes > 0),
  console_type   VARCHAR(10) REFERENCES pricing (console_type) ON UPDATE CASCADE, -- NULL = any console
  validity_days  INTEGER NOT NULL CHECK (validity_days BETWEEN 1 AND 3650),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A package bought by a customer. Plan details are copied at purchase time so
-- later plan edits never change what a customer already bought.
CREATE TABLE memberships (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  plan_id        UUID REFERENCES membership_plans (id) ON DELETE SET NULL,
  plan_name      VARCHAR(60) NOT NULL,
  console_type   VARCHAR(10), -- NULL = any console
  minutes_total  INTEGER NOT NULL CHECK (minutes_total > 0),
  minutes_used   INTEGER NOT NULL DEFAULT 0,
  price          NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  purchased_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  status         VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memberships_minutes_used_range CHECK (minutes_used >= 0 AND minutes_used <= minutes_total),
  CONSTRAINT memberships_expiry_after_purchase CHECK (expires_at > purchased_at)
);
CREATE INDEX memberships_customer_idx ON memberships (customer_id, expires_at DESC);

-- A session may be played against a membership. membership_minutes records how
-- many minutes the membership covered when the session was settled.
ALTER TABLE sessions ADD COLUMN membership_id UUID REFERENCES memberships (id) ON DELETE RESTRICT;
ALTER TABLE sessions ADD COLUMN membership_minutes INTEGER CHECK (membership_minutes IS NULL OR membership_minutes >= 0);
CREATE INDEX sessions_membership_idx ON sessions (membership_id) WHERE membership_id IS NOT NULL;

-- Invoices now come from either a session or a membership sale (exactly one).
ALTER TABLE invoices ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN membership_id UUID UNIQUE REFERENCES memberships (id) ON DELETE RESTRICT;
ALTER TABLE invoices ADD CONSTRAINT invoices_one_source CHECK ((session_id IS NOT NULL) <> (membership_id IS NOT NULL));

-- Keep the Supabase Data API locked out of the new tables too.
ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON membership_plans, memberships FROM %I', r);
    END IF;
  END LOOP;
END $$;
