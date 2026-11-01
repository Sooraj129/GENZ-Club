-- More console types: racing steering wheel rigs and VR stations.
--
-- The pricing table is the list of console types. Each type gets a display
-- name and a sort order so the UI can list them consistently
-- (PS5, PS4, Steering Wheel, VR).

ALTER TABLE pricing DROP CONSTRAINT IF EXISTS pricing_console_type_check;
ALTER TABLE pricing ADD CONSTRAINT pricing_console_type_check
  CHECK (console_type IN ('PS4', 'PS5', 'STEERING', 'VR'));

ALTER TABLE pricing ADD COLUMN label VARCHAR(40);
ALTER TABLE pricing ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

UPDATE pricing SET label = 'PS5', sort_order = 1 WHERE console_type = 'PS5';
UPDATE pricing SET label = 'PS4', sort_order = 2 WHERE console_type = 'PS4';

-- Starting prices — the admin should set the real ones in Settings → Pricing.
INSERT INTO pricing (console_type, hourly_rate, label, sort_order) VALUES
  ('STEERING', 150.00, 'Steering Wheel', 3),
  ('VR', 200.00, 'VR', 4)
ON CONFLICT (console_type) DO NOTHING;

ALTER TABLE pricing ALTER COLUMN label SET NOT NULL;
