-- Section 1: Create the main athlete_aliases table
CREATE TABLE IF NOT EXISTS public.athlete_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usaw_lifter_id BIGINT NOT NULL REFERENCES public.usaw_lifters(lifter_id) ON DELETE RESTRICT,
    iwf_db_lifter_id BIGINT NOT NULL REFERENCES public.iwf_lifters(db_lifter_id) ON DELETE RESTRICT,
    match_confidence NUMERIC CHECK (match_confidence >= 0 AND match_confidence <= 100),
    manual_override BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_usaw_iwf_link UNIQUE(usaw_lifter_id, iwf_db_lifter_id)
);

-- Section 2: Create the trigger function
CREATE OR REPLACE FUNCTION update_athlete_aliases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Section 3: Attach the trigger to the table
CREATE TRIGGER trigger_update_athlete_aliases_updated_at
BEFORE UPDATE ON public.athlete_aliases
FOR EACH ROW
EXECUTE FUNCTION update_athlete_aliases_updated_at();

-- Section 4: Create USAW ID lookup index
CREATE INDEX IF NOT EXISTS idx_athlete_aliases_usaw_id ON public.athlete_aliases(usaw_lifter_id);

-- Section 5: Create IWF ID lookup index
CREATE INDEX IF NOT EXISTS idx_athlete_aliases_iwf_id ON public.athlete_aliases(iwf_db_lifter_id);
