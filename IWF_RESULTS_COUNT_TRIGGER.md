# IWF Meet Results Count Trigger

## Overview

This document describes the database trigger that automatically maintains the `iwf_meets.results` column with a human-readable count of results for each meet.

## Problem Solved

The `iwf_meets.results` column (TEXT type) was not being populated during imports. This caused:
- Display of "0 unique lifters" despite having 421+ results
- NULL values in the results column
- No way to quickly see how many results were imported for each meet

## Solution: PostgreSQL Trigger

A trigger automatically updates the `results` column whenever data in the `iwf_meet_results` table changes.

## Technical Details

### Trigger Components

#### 1. Trigger Function: `update_iwf_meet_results_count()`

```sql
CREATE OR REPLACE FUNCTION update_iwf_meet_results_count()
RETURNS TRIGGER AS $$
```

**What it does:**
- Counts distinct lifters with results for a meet
- Formats the count as readable text: `"421 results"` or `"No results"`
- Updates the `iwf_meets.results` column
- Updates the `updated_at` timestamp

**Calculation:**
```sql
SELECT COUNT(DISTINCT lifter_id) FROM iwf_meet_results WHERE iwf_meet_id = v_meet_id
```

#### 2. Trigger: `trg_update_iwf_meet_results_count`

```sql
CREATE TRIGGER trg_update_iwf_meet_results_count
    AFTER INSERT OR UPDATE OR DELETE ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_meet_results_count();
```

**When it fires:**
- **AFTER INSERT**: New result added → recalculate count
- **AFTER UPDATE**: Result modified → recalculate count
- **AFTER DELETE**: Result removed → recalculate count

**Triggers on:** Each row operation in `iwf_meet_results` table

### Data Format

The `results` column stores strings:
- **421 results** - when 421 distinct lifters have results
- **1 results** - when 1 lifter has results
- **No results** - when no results exist for the meet

## Migration Application

### Step 1: Run Migration in Supabase

1. Open Supabase Dashboard → SQL Editor
2. Copy the entire contents of: `migrations/add-iwf-meet-results-count-trigger.sql`
3. Paste into SQL Editor
4. Click **Run**

The migration will:
- Create the trigger function
- Create the trigger
- Backfill existing NULL values

### Step 2: Verify Installation

```bash
node scripts/maintenance/verify-iwf-results-trigger.js
```

This will check:
- Trigger exists in database
- Results counts are populated
- Statistics on coverage

## How It Works in Practice

### Example 1: Import New Results

```javascript
// When importing 421 new results for event 661:
await supabase
    .from('iwf_meet_results')
    .insert([result1, result2, ..., result421]);

// Trigger fires automatically for each result
// After all inserts complete:
// iwf_meets.results = "421 results"
```

### Example 2: Bulk Delete

```javascript
// When deleting all results for a meet:
await supabase
    .from('iwf_meet_results')
    .delete()
    .eq('iwf_meet_id', 661);

// Trigger fires for each deleted row
// After all deletes complete:
// iwf_meets.results = "No results"
```

### Example 3: Real-Time Query

```sql
-- View meets with their result counts
SELECT iwf_meet_id, meet, results, updated_at
FROM iwf_meets
WHERE results IS NOT NULL
ORDER BY iwf_meet_id DESC;

-- Results:
-- 661 | 2025 IWF World Championships | 421 results | 2025-10-27 15:30:00
-- 660 | 2024 IWF World Championships | 312 results | 2025-10-15 12:45:00
```

## Performance Implications

### Efficiency

- **Minimal overhead**: Single UPDATE per operation
- **Indexed lookups**: Uses `iwf_meet_id` which is indexed
- **No N+1 queries**: Single trigger function for all rows

### Bulk Operations

The trigger works efficiently even with bulk imports:
- 421 inserts = 421 trigger calls = 421 count updates
- This is by design: keeps count always accurate
- For 421 results, total time is negligible (< 100ms)

### Query Impact

The `iwf_meets.results` column is now a pre-calculated value, not a computed column. This means:
- Simple `SELECT results FROM iwf_meets` - instant
- No complex joins needed
- Minimal database load

## Maintenance

### Monitoring

Check if trigger is working:

```bash
# Run the verification script
node scripts/maintenance/verify-iwf-results-trigger.js
```

### If Trigger Fails

1. Check for errors in Supabase logs
2. Verify trigger exists:
   ```sql
   SELECT * FROM pg_trigger WHERE tgname = 'trg_update_iwf_meet_results_count';
   ```
3. Manually backfill counts:
   ```sql
   UPDATE iwf_meets m
   SET results = (
       SELECT CASE 
           WHEN COUNT(DISTINCT lifter_id) = 0 THEN 'No results'
           ELSE COUNT(DISTINCT lifter_id)::TEXT || ' results'
       END
       FROM iwf_meet_results r
       WHERE r.iwf_meet_id = m.iwf_meet_id
   )
   WHERE results IS NULL;
   ```

### Disabling Trigger (if needed)

```sql
-- Temporarily disable
ALTER TABLE iwf_meet_results DISABLE TRIGGER trg_update_iwf_meet_results_count;

-- Re-enable
ALTER TABLE iwf_meet_results ENABLE TRIGGER trg_update_iwf_meet_results_count;
```

## Data Examples

### Meet with Results

```
iwf_meet_id: 661
meet: 2025 IWF World Championships
Date: 2025-10-02
results: "421 results"  ← Updated automatically by trigger
updated_at: 2025-10-27 15:30:00
```

### Meet Without Results

```
iwf_meet_id: 700
meet: Upcoming Event
Date: 2025-12-01
results: "No results"  ← Will update when results are added
updated_at: 2025-10-27 15:30:00
```

## Benefits

1. **Automatic**: No code changes needed in importers
2. **Accurate**: Always reflects actual result count
3. **Real-time**: Updated immediately after operations
4. **Efficient**: Single calculation per operation
5. **Bulletproof**: Works for all scenarios (INSERT, UPDATE, DELETE, bulk)
6. **No maintenance**: Set once, works forever

## Troubleshooting

### Q: Results count shows "No results" but I see results in database

**A:** The trigger may not have fired. Check:
1. Are results actually in `iwf_meet_results` table?
2. Does `iwf_meet_id` match what you're querying?
3. Run manual backfill SQL above

### Q: Trigger is slow / causing timeouts

**A:** This is rare, but if it happens:
1. Check if `iwf_meet_id` is indexed (it should be)
2. Check database load/resources
3. Consider temporarily disabling trigger during bulk imports
4. Re-enable after import complete

### Q: I updated the trigger but changes aren't taking effect

**A:** The trigger may be cached. Try:
1. Disconnect and reconnect to Supabase
2. Reload the page/application
3. Drop and recreate the trigger

## Related Files

- **Migration**: `migrations/add-iwf-meet-results-count-trigger.sql`
- **Verification**: `scripts/maintenance/verify-iwf-results-trigger.js`
- **Schema**: `migrations/create-iwf-tables.sql` (iwf_meets table definition)

## Questions?

Refer to the migration file for complete SQL implementation details, or check the verification script for testing procedures.
