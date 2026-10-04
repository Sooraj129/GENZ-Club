-- Supabase exposes the public schema over its REST Data API using the
-- publishable (anon) key. This application only talks to the database through
-- the backend, so lock every table down: RLS on with no policies means the
-- anon/authenticated roles can read and write nothing. The backend connects as
-- the database owner, which bypasses RLS.

ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing          ENABLE ROW LEVEL SECURITY;
ALTER TABLE consoles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
