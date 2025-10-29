# IWF Analytics Setup Guide

This guide explains how to set up PostgreSQL triggers in the IWF database to automatically populate analytics fields, matching the USAW database pattern.

## Problem Statement

The IWF database import script calculates analytics fields in JavaScript but these fields are not being populated in the database upon upsert. The USAW database solves this with PostgreSQL triggers that automatically calculate analytics on INSERT/UPDATE.

## Solution Overview

We've created PostgreSQL triggers that automatically populate:

- **snatch_successful_attempts** - Count of successful snatch attempts (0-3)
- **cj_successful_attempts** - Count of successful C&J attempts (0-3)
- **total_successful_attempts** - Total successful attempts (0-6)
- **bounce_back_snatch_2** - Made 2nd snatch after missing 1st?
- **bounce_back_snatch_3** - Made 3rd snatch after missing 2nd?
- **bounce_back_cj_2** - Made 2nd C&J after missing 1st?
- **bounce_back_cj_3** - Made 3rd C&J after missing 2nd?
- **competition_age** - Age at time of competition
- **qpoints** - Q-score for ages 21-30
- **q_youth** - Youth Q-score for ages 10-20
- **q_masters** - Masters Q-score for ages 31+

## Implementation Steps

### Step 1: Apply the Migration SQL (One-Time Setup)

1. Open **Supabase SQL Editor** for your IWF database
2. Copy the entire contents of: `migrations/add-iwf-analytics-triggers.sql`
3. Paste into the SQL editor
4. Click **Execute** (or Run Query)
5. You should see "Success" messages for each function and trigger creation

**What this does:**
- Creates 4 trigger functions for analytics calculation
- Creates 5 triggers that fire automatically on INSERT/UPDATE
- No changes to existing data yet

### Step 2: Verify Triggers Are Created

In the Supabase SQL Editor, run:

```sql
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'iwf_meet_results'
ORDER BY trigger_name;
```

You should see 5 triggers:
- `iwf_meet_results_analytics_insert_trigger`
- `iwf_meet_results_analytics_update_trigger`
- `iwf_meet_results_manual_override_trigger`
- `iwf_meet_results_qpoints_auto_update`
- `iwf_meet_results_competition_age_trigger`

### Step 3: Backfill Existing Records (Optional)

If you already have IWF meet results in the database, run the backfill script to populate analytics for existing records:

```bash
# Test first (dry run)
node scripts/maintenance/backfill-iwf-analytics.js --dry-run --limit 100

# Process all records
node scripts/maintenance/backfill-iwf-analytics.js

# With verbose output
node scripts/maintenance/backfill-iwf-analytics.js --verbose
```

This script:
- Fetches existing records in batches
- Updates each record (triggers automatic analytics calculation)
- Shows progress and summary

### Step 4: Test New Imports

Run a new IWF import to verify analytics are now populated:

```bash
node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 10
```

Then query the database to verify analytics fields are populated:

```sql
SELECT
    lifter_name,
    weight_class,
    total,
    snatch_successful_attempts,
    cj_successful_attempts,
    competition_age,
    qpoints,
    q_youth,
    q_masters
FROM iwf_meet_results
WHERE iwf_meet_id = (SELECT db_meet_id FROM iwf_meets WHERE event_id = '661' LIMIT 1)
LIMIT 5;
```

All analytics fields should be populated!

## How Triggers Work

### Trigger 1: Analytics Calculation (`iwf_meet_results_analytics_insert_trigger`)

**When:** Fires on INSERT to `iwf_meet_results`

**Calculates:**
- Counts successful attempts (positive values in snatch/cj attempt fields)
- Determines bounce-back metrics (recovery after missed attempts)

**Example:**
- snatch_lift_1 = "100" (successful) → counted
- snatch_lift_1 = "-100" (missed) → not counted
- snatch_lift_1 = "---" or NULL → not counted

### Trigger 2: Analytics Update (`iwf_meet_results_analytics_update_trigger`)

**When:** Fires when any lift attempt field or date changes

**Recalculates:** Same as trigger 1 (for data corrections)

### Trigger 3: Competition Age (`iwf_meet_results_competition_age_trigger`)

**When:** Fires when date or birth_year is inserted/updated

**Calculates:** `competition_age = YEAR(date) - birth_year`

### Trigger 4: Q-Points (`iwf_meet_results_qpoints_auto_update`)

**When:** Fires on any INSERT or UPDATE

**Calculates:** Using Huebner formula
- Ages 10-20: q_youth only
- Ages 21-30: qpoints only
- Ages 31+: q_masters only

### Trigger 5: Manual Override (`iwf_meet_results_manual_override_trigger`)

**When:** Fires before any INSERT or UPDATE

**Purpose:** Respects manual_override flag for manual data entry

## Architecture: JavaScript + Database Triggers

### Why Both?

1. **JavaScript (iwf-analytics.js):**
   - Enriches data BEFORE database insertion
   - Provides immediate feedback in import logs
   - Allows testing calculations before database commit

2. **Database Triggers:**
   - Ensure consistency regardless of import method
   - Recalculate if underlying data (lifts, dates) changes
   - Provide data integrity guarantees
   - Match USAW pattern for consistency

This is the same pattern as USAW:
```
Scraper Data → JavaScript Enrichment → Database Insert → Triggers Recalculate
```

## Troubleshooting

### Analytics fields still null after import?

1. **Check triggers exist:**
   ```sql
   SELECT count(*) FROM information_schema.triggers
   WHERE event_object_table = 'iwf_meet_results';
   ```
   Should return 5 triggers.

2. **Check for errors in function creation:**
   - Look for error messages when applying migration SQL
   - Check function syntax in `migrations/add-iwf-analytics-triggers.sql`

3. **Manual trigger test:**
   ```sql
   UPDATE iwf_meet_results
   SET snatch_lift_1 = snatch_lift_1
   WHERE iwf_result_id = 1;

   -- Check if analytics updated
   SELECT snatch_successful_attempts FROM iwf_meet_results
   WHERE iwf_result_id = 1;
   ```

### Q-Points showing null?

Q-scores depend on:
- Total (competition total) ✓ should exist
- body_weight_kg (competition bodyweight) ✓ should exist
- gender (M or F) ✓ should exist
- competition_age (calculated by trigger) ✓ should calculate automatically

If q_points is null, verify these fields are populated first.

### Backfill script too slow?

Adjust in `backfill-iwf-analytics.js`:
```javascript
const BATCH_SIZE = 100;  // Increase to 200 for faster processing
const DELAY_MS = 500;    // Decrease to 100 to reduce delays
```

## Comparison: USAW vs IWF

| Feature | USAW | IWF |
|---------|------|-----|
| Analytics in JS | Yes | Yes |
| Triggers on INSERT | Yes | Yes ✓ NEW |
| Triggers on UPDATE | Yes | Yes ✓ NEW |
| Competition age trigger | Yes | Yes ✓ NEW |
| Q-points trigger | Yes | Yes ✓ NEW |
| Manual override handling | Yes | Yes ✓ NEW |
| Database | meet_results | iwf_meet_results |

## Files Modified/Created

- **Created:** `migrations/add-iwf-analytics-triggers.sql` - Main trigger definitions
- **Created:** `scripts/maintenance/backfill-iwf-analytics.js` - Backfill script
- **Created:** `IWF_ANALYTICS_SETUP.md` - This guide
- **No changes:** `scripts/production/iwf-analytics.js` - Continue using for enrichment
- **No changes:** `scripts/production/iwf-results-importer.js` - Continue using as-is

## Next Steps

1. Apply the migration SQL in Supabase
2. Verify triggers exist
3. Run backfill on existing data (if any)
4. Test with new imports
5. Monitor for any issues in subsequent imports

## Support

For issues or questions:
1. Check the trigger function definitions in `add-iwf-analytics-triggers.sql`
2. Review the backfill script logs in `backfill-iwf-analytics.js`
3. Use the troubleshooting section above
4. Check database error logs in Supabase dashboard

---

**Status:** Ready for deployment
**Last Updated:** 2025-01-26
**Compatibility:** IWF database schema v1.0
