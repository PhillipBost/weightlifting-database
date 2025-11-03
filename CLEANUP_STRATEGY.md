# Cleanup Strategy: Removing 19,052 Phantom Records

**Status:** Ready for Execution
**Risk Level:** MEDIUM (must backup first)
**Expected Outcome:** Clean database, correct event results

## Overview

This strategy removes all 19,052 phantom duplicate records identified by the performance fingerprinting analysis. These are confirmed duplicates where the exact same performance appears under multiple different events - chronologically impossible combinations that represent data corruption, not legitimate competitions.

## Pre-Deletion Validation

### 1. Verify Phantom Records Match IWF.sport

Before deletion, sample verification against official IWF.sport:

```sql
-- Identify highest-risk records (6 copies in one group)
SELECT DISTINCT group_id, lifter_name, meet_name, db_result_id
FROM iwf_meet_results r
WHERE EXISTS (
  SELECT 1 FROM phantom_duplicate_groups g
  WHERE g.group_id = r.group_id AND g.duplicate_count = 6
);
```

**Action:** For each record, check event at IWF.sport:
- athlete URL: `https://iwf.sport/weightlifting_/athletes-bios/?athlete=<name>&id=<iwf_lifter_id>`
- event URL: from `iwf_meets.url`

**Decision Rule:**
- If performance appears in only ONE event on IWF.sport: other copies are phantoms → DELETE
- If performance appears in multiple events: investigate further → HOLD FOR REVIEW

### 2. Backup Strategy

**CRITICAL:** Create immutable backup before deletion

```bash
# Export phantom records to archive
SELECT * FROM iwf_meet_results
WHERE db_result_id IN (
  <list of 19,052 db_result_ids from export>
)
INTO OUTFILE '/backup/phantom_records_2025-11-01.csv';

-- Also backup the iwf_meets table
SELECT * FROM iwf_meets
WHERE db_meet_id IN (
  SELECT DISTINCT db_meet_id
  FROM phantom_meet_pairs
)
INTO OUTFILE '/backup/phantom_meets_2025-11-01.csv';
```

## Deletion Strategy

### Phase 1: Identify Records to Delete

Create SQL to identify which specific `db_result_id` values should be deleted:

**Rule:** For each duplicate group, keep the record that:
1. Matches the correct event on IWF.sport
2. Has the earliest `created_at` timestamp (original import)
3. DELETE all other copies in the group

```sql
-- Find records to DELETE (keep the one with earliest created_at per group)
WITH keep_records AS (
  SELECT group_id, MIN(db_result_id) as keep_id
  FROM iwf_meet_results r
  WHERE db_result_id IN (
    -- All result_ids from the 19,052 phantom records
  )
  GROUP BY group_id
)
SELECT db_result_id
FROM iwf_meet_results r
WHERE db_result_id IN (
  SELECT DISTINCT db_result_id
  FROM iwf_meet_results
  WHERE db_result_id IN (/* 19,052 ids */)
)
AND db_result_id NOT IN (
  SELECT keep_id FROM keep_records
);
```

### Phase 2: Safety Checks Before Deletion

**NEVER delete without checking:**

```sql
-- Verify foreign key integrity before deletion
SELECT COUNT(*) FROM iwf_meet_results WHERE db_result_id IN (<delete_list>);
-- Should be exactly 19,052 if fully identified

-- Check for any recent modifications (last 24 hours)
SELECT COUNT(*) FROM iwf_meet_results
WHERE db_result_id IN (<delete_list>)
AND updated_at > NOW() - INTERVAL 1 DAY;
-- Should be 0 (no recent changes)

-- Verify no related tables reference these results
SELECT COUNT(*) FROM meet_entries WHERE result_id IN (<delete_list>);
-- Should be 0 if no relationships exist
```

### Phase 3: Deletion

**Option A: Direct Deletion** (if confident)

```sql
DELETE FROM iwf_meet_results
WHERE db_result_id IN (<delete_list>);

-- Verify deletion
SELECT COUNT(*) FROM iwf_meet_results;
-- Should decrease by 19,052
```

**Option B: Soft Delete** (safer, reversible)

```sql
UPDATE iwf_meet_results
SET manual_override = TRUE,
    deleted_at = NOW(),
    notes = CONCAT(notes, ' | PHANTOM DUPLICATE - MARKED FOR DELETION')
WHERE db_result_id IN (<delete_list>);

-- Then exclude from queries:
SELECT * FROM iwf_meet_results
WHERE deleted_at IS NULL;

-- Can be hard-deleted after validation period
```

### Phase 4: Post-Deletion Verification

```sql
-- Verify no duplicates remain
SELECT COUNT(*) as duplicate_count
FROM (
  SELECT COUNT(*) as cnt
  FROM iwf_meet_results
  GROUP BY
    lifter_name, birth_year, gender, weight_class, body_weight_kg,
    snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
    cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total, rank,
    competition_group, snatch_successful_attempts,
    cj_successful_attempts, total_successful_attempts, qpoints
  HAVING cnt > 1 AND COUNT(DISTINCT db_meet_id) > 1
) duplicates;
-- Should be 0

-- Check total record count
SELECT COUNT(*) FROM iwf_meet_results;
-- Should be ~190,000 - 19,052 = ~171,000
```

## Rollback Plan

If deletion causes issues:

1. **Immediate rollback** (within 1 hour):
   ```sql
   -- Restore from backup if soft delete
   UPDATE iwf_meet_results
   SET deleted_at = NULL
   WHERE db_result_id IN (<delete_list>);
   ```

2. **Restore from backup** (if hard delete):
   - Restore from pre-deletion backup
   - Requires database downtime

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Accidental deletion of valid records | LOW | HIGH | Pre-deletion validation against IWF.sport |
| Foreign key constraint violation | LOW | HIGH | Check meet_entries/other references first |
| Database performance during delete | MEDIUM | MEDIUM | Delete in batches of 1000, not all at once |
| Backup failure | LOW | CRITICAL | Test backup restore before deletion |
| Analytics showing incorrect data until recalculation | HIGH | MEDIUM | Recalculate after deletion complete |

## Post-Deletion Tasks

1. **Recalculate affected analytics:**
   - Event result counts per meet_id
   - Athlete total competition count
   - YTD calculations (will change for affected athletes)
   - National rankings/standings

2. **Notify stakeholders:**
   - Document which events were affected
   - Explain why records were deleted
   - Provide before/after metrics

3. **Implement prevention:**
   - Add unique constraint on (db_lifter_id, db_meet_id, weight_class)
   - Add duplicate detection to import pipeline
   - Add event_id validation to scraper

## Execution Checklist

- [ ] Create immutable backup of phantom records
- [ ] Test backup restoration
- [ ] Run sample verification against IWF.sport (10-20 records)
- [ ] Document findings
- [ ] Get approval from stakeholders
- [ ] Run all safety checks (Phase 2)
- [ ] Execute deletion on staging/test first
- [ ] Verify no data loss on test
- [ ] Execute deletion on production
- [ ] Run post-deletion verification
- [ ] Monitor system for 24 hours
- [ ] Recalculate analytics
- [ ] Implement prevention measures
- [ ] Document incident report

## Timeline

- **Phase 1 (Today):** Export phantom records, backup
- **Phase 2 (Tomorrow):** Sample verification against IWF.sport
- **Phase 3 (Day 3):** Execute deletion on test environment
- **Phase 4 (Day 4):** Production deletion + verification
- **Phase 5 (Day 5-7):** Analytics recalculation + monitoring
- **Phase 6 (Week 2):** Prevention implementation
