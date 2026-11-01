-- 1. Group play: several players on one console, each paying the hourly rate.
--    max_players per console type: PS5/PS4 up to 5, Steering Wheel and VR are single-player.
ALTER TABLE pricing ADD COLUMN max_players INTEGER NOT NULL DEFAULT 1 CHECK (max_players BETWEEN 1 AND 10);
UPDATE pricing SET max_players = 5 WHERE console_type IN ('PS5', 'PS4');

ALTER TABLE sessions ADD COLUMN players INTEGER NOT NULL DEFAULT 1 CHECK (players BETWEEN 1 AND 10);

-- 2. Walk-in customers without their own phone get the shop's default number
--    6381897882. Many customers may share that number; every other phone number
--    stays unique.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_key;
CREATE UNIQUE INDEX customers_phone_unique ON customers (phone) WHERE phone <> '6381897882';
CREATE INDEX customers_phone_idx ON customers (phone);
