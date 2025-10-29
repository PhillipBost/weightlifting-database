# How to Apply IWF YTD Trigger Fix

## Problem Found
The YTD trigger was using the wrong column name (`result_id` instead of `db_result_id`), causing it to fail silently.

## Quick Fix (3 Steps)

### Step 1: Apply the Trigger to Database
1. Log into **Supabase** (IWF database)
2. Go to **SQL Editor**
3. Open file: `migrations/fix-iwf-ytd-trigger-correct-column-names.sql`
4. Copy the entire contents
5. Paste into SQL Editor
6. Click **Run**
7. Verify: Should see "Success. No rows returned"

### Step 2: Backfill Existing Records
Run this command from your terminal:
```bash
cd "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database"
node scripts/maintenance/backfill-iwf-ytd.js
```

**Alternative** (if backfill script doesn't exist):
Run this SQL in Supabase SQL Editor:
```sql
UPDATE iwf_meet_results
SET updated_at = NOW()
WHERE date >= '2025-01-01';
```

### Step 3: Test with New Import
```bash
node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 10
```

**Expected**: All 10 records should have YTD fields populated

### Step 4: Verify (Optional)
```bash
node scripts/maintenance/verify-iwf-ytd-trigger.js
```

**Expected Output**:
```
================================================================================
IWF YTD TRIGGER VERIFICATION
================================================================================

2. Checking sample records for YTD values...
   Found 10 records

   ✅ Hao YUAN (Oct 02, 2025)
      Lifts: 132/168/300
      YTD:   132/168/300

   ✅ Theerapong SILACHAI (Oct 02, 2025)
      Lifts: 129/164/293
      YTD:   129/164/293

   ...

   Summary: 10 with YTD, 0 without YTD

================================================================================
DIAGNOSIS SUMMARY
================================================================================
✅ Everything looks good!
   YTD fields are populated correctly
================================================================================
```

## What Changed

**Before**:
- YTD fields: NULL/NULL/NULL
- Trigger using wrong column: `result_id`
- Silent failures

**After**:
- YTD fields: 132/168/300 (actual values)
- Trigger using correct column: `db_result_id`
- Errors surface if anything goes wrong

## Files
- **Migration SQL**: `migrations/fix-iwf-ytd-trigger-correct-column-names.sql`
- **Verification Script**: `scripts/maintenance/verify-iwf-ytd-trigger.js`
- **Full Details**: `IWF_YTD_FIX_SUMMARY.md`

## Need Help?
Check the detailed summary: `IWF_YTD_FIX_SUMMARY.md`
