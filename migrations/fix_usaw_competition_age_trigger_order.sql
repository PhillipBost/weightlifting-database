-- Owner-run migration.
-- Ensures competition_age is recalculated before all score triggers on public.usaw_meet_results,
-- and ensures trigger_update_gamx_usaw fires when birth_year or date is updated.
BEGIN;

ALTER TRIGGER update_competition_age_trigger
    ON public.usaw_meet_results
    RENAME TO aa_update_competition_age_trigger;

DROP TRIGGER IF EXISTS trigger_update_gamx_usaw ON public.usaw_meet_results;
CREATE TRIGGER trigger_update_gamx_usaw
    BEFORE INSERT OR UPDATE OF total, best_snatch, best_cj, body_weight_kg, competition_age, gender, birth_year, date
    ON public.usaw_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION public.update_gamx_scores();

COMMIT;
