# Lifter Data Demerge Plan

**Problem:** Multiple distinct athletes merged into single `db_lifter_id` due to name-only matching

**Example:**
- db_lifter_id=37814 contains both:
  - Tigran Martirosyan (born ~1989)
  - Tigran Martirosyan (born ~1991)
  - But database shows only ONE birth_year

**Root Cause:** `iwf-lifter-manager.js` matches on `name + country` only, not birth_year

---

## How to Fix

### Step 1: Identify All Merged Lifters

Run this query to find lifters with inconsistent data (same name, multiple weight classes at same meet):

```sql
-- Lifters with suspicious activity patterns (likely merged)
SELECT
    l.db_lifter_id,
    l.athlete_name,
    l.birth_year,
    l.iwf_lifter_id,
    l.country_code,
    COUNT(DISTINCT r.weight_class) as weight_classes_in_same_meet,
    MAX(CASE WHEN r.total IS NOT NULL THEN r.total::int ELSE 0 END) as best_total,
    COUNT(DISTINCT r.db_meet_id) as meets_competed
FROM iwf_lifters l
LEFT JOIN iwf_meet_results r ON l.db_lifter_id = r.db_lifter_id
WHERE (l.db_lifter_id, l.db_meet_id) IN (
    SELECT db_meet_id, db_lifter_id
    FROM iwf_meet_results
    GROUP BY db_meet_id, db_lifter_id
    HAVING COUNT(*) > 1
)
GROUP BY l.db_lifter_id, l.athlete_name, l.birth_year, l.iwf_lifter_id, l.country_code
ORDER BY l.athlete_name, l.country_code;
```

### Step 2: Check IWF Website

For each suspected merge (e.g., Tigran Martirosyan), visit:
- https://iwf.sport/athletes/?search=Tigran+Martirosyan

Compare:
- Birth dates
- Career timeline (first/last competitions)
- IWF Athlete IDs
- Height/weight patterns

### Step 3: Correct the Data

For each lifter that should be split:

**Option A: If you have iwf_lifter_id**
- Create new `db_lifter_id` record with correct info
- Reassign results to correct athlete using iwf_lifter_id match
- Delete old merged record

**Option B: If no iwf_lifter_id available**
- Create new record with name + country + correct birth_year
- Manually assign results based on:
  - Date patterns (when did each athlete actually compete?)
  - Weight class patterns (body weight trajectory)
  - Performance progression

### Step 4: Update Lifter Matcher

Fix `iwf-lifter-manager.js` to prevent future merges:

**Current (broken):**
```javascript
const existingLifter = liftersInCountry.find(
    lifter => getMatchKey(lifter.athlete_name) === matchKey
);
```

**Should be:**
```javascript
const existingLifter = liftersInCountry.find(lifter => {
    const nameMatches = getMatchKey(lifter.athlete_name) === matchKey;
    const birthYearMatches = !birthYear || !lifter.birth_year || lifter.birth_year === birthYear;
    return nameMatches && birthYearMatches;
});
```

Or better - **use iwf_lifter_id as primary key always** if available.

---

## Affected Results (28 records)

These duplicate results only exist because lifters are merged:

| db_meet_id | db_lifter_id | Issue |
|-----------|-------------|-------|
| 656 | 25620 | Competing in 77kg and 85kg at same meet |
| 673 | 25063 | Competing in 69kg and 85kg at same meet |
| 681 | 25063 | Competing in 69kg and 85kg at same meet |
| 1013 | 37814 | **Tigran Martirosyan merge - different birth years** |
| ... | ... | (14 pairs total) |

All of these could be legitimate (same athlete, different weight classes) OR symptoms of merges (different athletes, same name).

---

## Decision Points

**Before cleaning up duplicates, decide:**

1. **Get IWF birth years?**
   - Check IWF website for each athlete
   - Update database with correct birth_year

2. **Split merged lifters?**
   - Separate into two db_lifter_id records
   - Reassign results correctly

3. **Or accept the ambiguity?**
   - Keep merged lifters as-is
   - Document which results are ambiguous
   - Change unique constraint to allow multiple weight classes

4. **Improve matching?**
   - Fix `iwf-lifter-manager.js` to require iwf_lifter_id
   - Add birth_year to fallback matching
   - Require manual review for name collisions

---

## Current Status

**DO NOT apply unique constraint until this is resolved.**

The 28 "duplicate" results are symptoms of the real problem: incorrect lifter merges.
