BEGIN;

-- Drop old strict constraints if they exist (using IF EXISTS to be safe)
ALTER TABLE "public"."usaw_meet_results" 
DROP CONSTRAINT IF EXISTS "meet_results_meet_id_lifter_id_key";

ALTER TABLE "public"."usaw_meet_results" 
DROP CONSTRAINT IF EXISTS "meet_results_meet_id_lifter_id_weight_class_key";

-- Add new constraint allowing duplicates with different performance
ALTER TABLE "public"."usaw_meet_results"
ADD CONSTRAINT "meet_results_unique_performance_key"
UNIQUE (meet_id, lifter_id, weight_class, best_snatch, best_cj, total);

COMMIT;
