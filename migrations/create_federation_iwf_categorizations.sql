-- ============================================================================
-- MIGRATION: IWF Member Federation Categorization (temporal)
-- Description:
--   Creates public.federation_iwf_categorizations, the longitudinal store for
--   the annual International Testing Agency (ITA) / International Weightlifting
--   Federation (IWF) anti-doping risk categorization of member federations
--   (Categories A / B / C).
--
--   Semantics:
--     - One row per (federation, effective period). A new annual list INSERTs
--       a new row and closes the previous period via valid_until; nothing is
--       updated in place.
--     - valid_until NULL = category currently in force ("true for present day").
--
--   Source of the 2026 rows:
--     ITA "2026 List of Categorised Member Federations",
--     version in force as of 1 January 2026 (8 pages, 192 members:
--     A=28, B=30, C=134).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.federation_iwf_categorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    federation_id UUID NOT NULL REFERENCES public.federation_registry(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('A', 'B', 'C')),
    valid_from DATE NOT NULL,
    valid_until DATE,                          -- NULL = currently in force
    citation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (federation_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_federation_iwf_categorizations_lookup
ON public.federation_iwf_categorizations (federation_id, valid_from, valid_until);

CREATE INDEX IF NOT EXISTS idx_federation_iwf_categorizations_current
ON public.federation_iwf_categorizations (category)
WHERE valid_until IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.federation_iwf_categorizations
TO anon, authenticated, service_role;
