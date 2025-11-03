-- Fix IWF Results Unique Constraint
-- Remove weight_class from constraint (athletes have one result per meet)
-- Weight class is not stable - athletes change classes over time

-- Drop the old constraint that included weight_class
DROP INDEX IF EXISTS idx_iwf_meet_results_unique;

-- Create new constraint without weight_class
-- One result per athlete per meet (identified by db_meet_id, db_lifter_id)
CREATE UNIQUE INDEX idx_iwf_meet_results_unique
ON iwf_meet_results(db_meet_id, db_lifter_id);

-- Verify constraint is in place
SELECT constraint_name, constraint_definition
FROM information_schema.table_constraints
WHERE table_name = 'iwf_meet_results' AND constraint_type = 'UNIQUE';
