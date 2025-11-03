# Fix Duplicate Detection Bug in IWF Results Importer

**Status:** In Progress
**Issue:** Duplicate records created on re-import due to weight_class in unique constraint
**Solution:** Use only (db_meet_id, db_lifter_id) for duplicate detection

---

## Problem Analysis

Current UNIQUE constraint includes `weight_class`:
```sql
UNIQUE (db_meet_id, db_lifter_id, weight_class)
```

**Issues:**
1. Weight class is not stable - athletes change classes over time
2. Allows multiple results for same athlete in same meet (wrong)
3. If duplicate detection uses weight_class and lifter lookup changes, creates phantom duplicates

---

## Solution: Option A (Normalized Schema)

### Changes Made

#### 1. SQL Migration ✅
**File:** `scripts/sql/fix-iwf-results-unique-constraint.sql`

Changes UNIQUE constraint to:
```sql
UNIQUE (db_meet_id, db_lifter_id)
```

One result per athlete per meet (weight class can vary).

#### 2. Code Update ✅
**File:** `scripts/production/iwf-results-importer.js` (line 203-213)

Removed `weight_class` from duplicate check query:
```javascript
// Before:
.eq('weight_class', resultData.weight_class)

// After:
// Removed - weight class varies, not part of unique key
```

---

## Testing Plan

### Test 1: Run SQL Migration
```bash
# Apply migration to IWF database
psql -h [host] -U [user] -d [db] -f scripts/sql/fix-iwf-results-unique-constraint.sql
```

**Verify:**
```sql
SELECT constraint_name, constraint_definition
FROM information_schema.table_constraints
WHERE table_name = 'iwf_meet_results' AND constraint_type = 'UNIQUE';
```

Expected: Single UNIQUE constraint on (db_meet_id, db_lifter_id)

### Test 2: Re-import Existing Event
```bash
# Import event 661 from 2025
node scripts/production/iwf-main.js --event-id 661 --year 2025

# Re-import same event (should UPDATE, not INSERT)
node scripts/production/iwf-main.js --event-id 661 --year 2025
```

**Verify in logs:**
- First run: "Created new meet", "Created new" for each lifter
- Second run: "Updated existing meet", "🔄 Updated" for results (not "Created new")

### Test 3: Check for Duplicates
```sql
-- Should return 0 rows
SELECT db_meet_id, db_lifter_id, COUNT(*) as cnt
FROM iwf_meet_results
GROUP BY db_meet_id, db_lifter_id
HAVING COUNT(*) > 1;
```

### Test 4: Verify Weight Class Handling
```sql
-- Show all results for a lifter across multiple meets
SELECT meet_id, lifter_id, weight_class, total, date
FROM iwf_meet_results
WHERE db_lifter_id = [test_lifter_id]
ORDER BY date;

-- Different meets = different rows (correct)
-- Same meet = one row (enforced by constraint)
```

---

## Files Changed

1. ✅ `scripts/sql/fix-iwf-results-unique-constraint.sql` - NEW
2. ✅ `scripts/production/iwf-results-importer.js` - MODIFIED (lines 205-213)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Old constraint violated by existing data | Migration fails | Check query Test 3 before migration |
| Duplicate results on re-import | Data corruption | Covered by Test 2 |
| Weight class variation | Lost data | Designed for this - one result per meet |

---

## Rollback Plan

If needed:
```bash
# Revert code change
git checkout scripts/production/iwf-results-importer.js

# Restore old constraint
DROP INDEX idx_iwf_meet_results_unique;
CREATE UNIQUE INDEX idx_iwf_meet_results_unique
ON iwf_meet_results(db_meet_id, db_lifter_id, weight_class);
```

---

## Next Steps

- [ ] Verify no existing duplicates: `SELECT ... HAVING COUNT(*) > 1`
- [ ] Apply SQL migration
- [ ] Test re-import behavior
- [ ] Verify no new duplicates created
- [ ] Enable monthly GitHub Action

**Once complete:** Monthly IWF scraper safe to run without duplicate risk
