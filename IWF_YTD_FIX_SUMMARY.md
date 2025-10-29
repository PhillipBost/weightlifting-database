# IWF YTD Trigger Fix - Summary

## Problem Identified

**YTD fields remaining NULL after successful imports**

### Root Cause
The database trigger SQL file (`migrations/update-iwf-ytd-trigger-include-current.sql`) used the wrong column name for the primary key:
- **Used**: `result_id`
- **Actual**: `db_result_id`

This caused the trigger to fail silently because:
1. The EXCEPTION WHEN OTHERS handler caught all errors
2. Column name mismatch prevented proper row exclusion during calculation
3. No error logs were generated

### Database State
- **Table**: `iwf_meet_results`
- **Primary Key**: `db_result_id` (bigint, auto-increment)
- **YTD Columns**: `best_snatch_ytd`, `best_cj_ytd`, `best_total_ytd` (all exist, all NULL)
- **Imports**: Working perfectly (10/10 successful with --limit 10)
- **Trigger**: Either not applied or failing silently

## Solution Created

### Fixed Migration File
**Location**: `migrations/fix-iwf-ytd-trigger-correct-column-names.sql`

**Key Fixes**:
1. **Correct column name**: `result_id` → `db_result_id`
2. **Better exclusion logic**: Use `TG_OP` to detect INSERT vs UPDATE
   - INSERT: No exclusion needed (NEW row not in table yet)
   - UPDATE: Exclude by `db_result_id != NEW.db_result_id`
3. **Removed EXCEPTION handler**: Errors will now surface instead of being hidden
4. **Simplified logic**: Clearer, more maintainable code

### Trigger Logic
```sql
-- On INSERT: Include all previous results + current result values
-- On UPDATE: Include all results except the row being updated + current values
WHERE db_lifter_id = NEW.db_lifter_id
  AND EXTRACT(YEAR FROM date::DATE) = v_year
  AND date <= NEW.date
  AND (
      (TG_OP = 'UPDATE' AND db_result_id != NEW.db_result_id)
      OR TG_OP = 'INSERT'
  )
```

## Implementation Steps

### 1. Apply Trigger to Database
1. Open Supabase SQL Editor for IWF database
2. Copy contents of `migrations/fix-iwf-ytd-trigger-correct-column-names.sql`
3. Execute the migration
4. Verify no errors

### 2. Backfill Existing Records
```bash
node scripts/maintenance/backfill-iwf-ytd.js
```

**Alternative**: Force trigger execution via UPDATE
```sql
UPDATE iwf_meet_results
SET updated_at = NOW()
WHERE date >= '2025-01-01';
```

### 3. Test with New Import
```bash
node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 10
```

### 4. Verify Success
```bash
node scripts/maintenance/verify-iwf-ytd-trigger.js
```

Expected output:
- ✅ 10/10 records with YTD fields populated
- YTD values match current lifts for first meet
- YTD values show MAX(previous, current) for repeat lifters

## Files Created/Modified

### New Files
- `migrations/fix-iwf-ytd-trigger-correct-column-names.sql` - Corrected trigger
- `scripts/maintenance/verify-iwf-ytd-trigger.js` - Diagnostic script
- `IWF_YTD_FIX_SUMMARY.md` - This file

### Context Files (For Reference)
- `migrations/update-iwf-ytd-trigger-include-current.sql` - Original (buggy) version
- `migrations/add-iwf-ytd-calculation-trigger.sql` - Even older version
- `scripts/maintenance/backfill-iwf-ytd.js` - Backfill script (already exists)
- `scripts/production/iwf-results-importer.js` - Import code (already correct, expects trigger)

## Testing Checklist

- [ ] Trigger applied to database without errors
- [ ] Backfill script runs successfully
- [ ] New imports have YTD fields populated
- [ ] First meet of year: YTD = current result
- [ ] Repeat lifter: YTD = MAX(all results this year including current)
- [ ] No errors in Supabase logs

## Expected Behavior After Fix

### First Meet of Year
```
Lifter: Hao YUAN
Date: 2025-10-02
Lifts: 132/168/300
YTD:   132/168/300  ← Should match current lifts
```

### Subsequent Meet (Same Lifter, Same Year)
```
Lifter: Hao YUAN
Date: 2025-11-15
Lifts: 135/170/305
YTD:   135/170/305  ← MAX(Oct result, Nov result)
```

If Nov lifts were LOWER:
```
Lifter: Hao YUAN
Date: 2025-11-15
Lifts: 130/165/295
YTD:   132/168/300  ← Keeps Oct bests (YTD = best SO FAR this year)
```

## Notes

- **No Code Changes Required**: Import code already expects trigger to handle YTD
- **Safe to Apply**: Transaction-wrapped, can rollback if needed
- **Backward Compatible**: Works with existing data
- **Performance**: Trigger runs only on INSERT/UPDATE, minimal overhead
