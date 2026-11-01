-- Duration corrections are recorded alongside amount corrections.
ALTER TABLE session_amount_changes ADD COLUMN old_duration INTEGER CHECK (old_duration IS NULL OR old_duration >= 0);
ALTER TABLE session_amount_changes ADD COLUMN new_duration INTEGER CHECK (new_duration IS NULL OR new_duration >= 0);
