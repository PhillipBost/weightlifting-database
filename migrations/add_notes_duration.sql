-- Add columns for improved data granularity
ALTER TABLE iwf_sanctions
ADD COLUMN IF NOT EXISTS notes text,
    ADD COLUMN IF NOT EXISTS duration text;
-- (Optional) If we wanted to enforce standard date formats, we'd need to cast, but we are keeping text for flexibility