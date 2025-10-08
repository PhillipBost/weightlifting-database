# Club WSO Assignment Fix - Add State Column

## Problem Summary

Clubs are being incorrectly assigned to WSOs because they lack an explicit `state` field that provides high-confidence (98%) assignments.

**Current Issues:**
- **Catalyst Athletics** (Deschutes County, Oregon) → Wrongly assigned to **California South** (should be Pacific Northwest)
- **Lotus Barbell Club** (Stockton, CA at 38.02°N) → Wrongly assigned to **California South** (should be California North Central)

## Root Cause

The `meet_locations` table has a `state` field which enables the highest-priority assignment strategy (98% confidence). The `clubs` table lacks this field and must rely on:
- Address parsing (85% confidence) - unreliable for bare addresses
- Coordinate-based boundaries (95% confidence) - works but requires polygon checking

## Solution: Add `state` Column to Clubs Table

### Step 1: Run SQL Migration

**You must run this SQL in Supabase SQL Editor:**

```sql
ALTER TABLE clubs ADD COLUMN state VARCHAR(50);
```

### Step 2: Verify Migration

Run the verification script:

```bash
node run-migration.js
```

Expected output:
```
✅ State column exists
📊 Current status:
   Total clubs: XXXX
   With state populated: 0
   Without state: XXXX
```

### Step 3: Analyze Backfill

Before running the backfill, analyze what will be updated:

```bash
node scripts/geographic/backfill-club-states.js --analyze
```

This will show:
- How many clubs can have states extracted
- Which extraction methods will be used
- Sample of what will be updated

### Step 4: Run Backfill

Populate the state column for all clubs:

```bash
node scripts/geographic/backfill-club-states.js --backfill
```

This script:
1. Extracts state from `address` field using text parsing
2. Falls back to coordinates if no state in address
3. Updates the `state` column in the database

### Step 5: Re-assign WSO Geography

Now that clubs have explicit state fields, re-run the WSO assignment:

```bash
node scripts/geographic/club-wso-assigner.js --assign
```

The engine will now use the high-confidence state field strategy.

### Step 6: Verify Fixes

Check that the problem clubs are now correctly assigned:

```bash
node test-ca-south-clubs.js
```

**Expected results:**
- ✅ Catalyst Athletics → Pacific Northwest
- ✅ Lotus Barbell Club → California North Central
- ✅ All barbell clubs in California South should actually be in southern California

## How It Works

The `wso-assignment-engine.js` already implements a priority-based strategy:

1. **State field (98% confidence)** ← NEW: Clubs will now use this!
2. **Coordinates (95% confidence)** ← Fallback
3. **Address parsing (85% confidence)** ← Last resort

### For California Clubs Specifically

Once a club has `state: 'California'`, the engine:
1. Uses point-in-polygon checking with actual WSO territory boundaries
2. Falls back to latitude-based division (35.5°N cutoff)
3. Falls back to city name matching

This ensures accurate North Central vs South assignments.

## Files Created

- `migrations/add_state_to_clubs.sql` - SQL migration
- `scripts/geographic/backfill-club-states.js` - Backfill script
- `run-migration.js` - Migration verification script
- `CLUB_STATE_FIX_README.md` - This file

## Expected Impact

- **Catalyst Athletics**: Oregon → Pacific Northwest ✅
- **Lotus Barbell**: Stockton (38°N) → California North Central ✅
- **All clubs**: More accurate, consistent WSO assignments
- **Assignment confidence**: Average increases from ~85% to ~98%

## Future Considerations

Update any club data collection scripts to extract and store the `state` field when new clubs are added. This ensures ongoing data quality.

## Rollback

If needed, remove the state column:

```sql
ALTER TABLE clubs DROP COLUMN state;
```

However, the column is harmless even if not populated, so rollback is not recommended.
