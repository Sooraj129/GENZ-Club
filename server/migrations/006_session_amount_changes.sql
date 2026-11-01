-- Corrections to session amounts, and deleting sessions — always with a reason,
-- and always recorded so every change can be traced.

-- A "deleted" session is kept (status CANCELLED) and marked here, so history,
-- reports and audits never lose it.
ALTER TABLE sessions ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN deleted_by UUID REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN delete_reason VARCHAR(300);
ALTER TABLE sessions ADD CONSTRAINT sessions_deleted_fields
  CHECK (deleted_at IS NULL OR (status = 'CANCELLED' AND delete_reason IS NOT NULL));

-- One row per change: amount edited, or session deleted.
CREATE TABLE session_amount_changes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  invoice_id  UUID REFERENCES invoices (id) ON DELETE SET NULL,
  action      VARCHAR(10) NOT NULL CHECK (action IN ('EDIT', 'DELETE')),
  old_amount  NUMERIC(10, 2) NOT NULL CHECK (old_amount >= 0),
  new_amount  NUMERIC(10, 2) NOT NULL CHECK (new_amount >= 0),
  reason      VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  changed_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX session_amount_changes_session_idx ON session_amount_changes (session_id, created_at);

-- Keep the Supabase Data API locked out.
ALTER TABLE session_amount_changes ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON session_amount_changes FROM %I', r);
    END IF;
  END LOOP;
END $$;
