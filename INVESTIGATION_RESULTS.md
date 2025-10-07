# Alabama WSO Active Lifters Count Investigation Results

**Date:** 2025-10-01  
**Issue:** Alabama WSO shows `active_lifters_count: 0` despite having recent competitions

## Executive Summary

The Alabama WSO (and multiple other WSOs) show 0 for `active_lifters_count` **not due to calculation errors or missing GeoJSON boundaries**, but because **recent meets are missing geocoded coordinates in the database**.

The analytics calculator requires coordinates to perform geometric filtering (point-in-polygon tests). Meets without coordinates are completely excluded from all WSO analytics.

## Root Cause Analysis

### What We Investigated

1. ✅ **SQL Schema Documentation** - Fixed: Comments incorrectly said "2 years", actual code uses 12 months
2. ✅ **GeoJSON Boundaries** - Validated: All 26 WSOs have valid `territory_geojson` data (100% coverage)
3. ✅ **Calculation Logic** - Correct: The calculator properly filters meets by coordinates within boundaries
4. ❌ **Meet Coordinates** - **PROBLEM FOUND**: 29% of recent meets missing coordinates

### Actual Root Cause

**Missing Geocoded Coordinates:**
- **Alabama:** 1 out of 1 recent meet (100%) missing coordinates
- **System-wide:** 133 out of 460 recent meets (29%) missing coordinates
- **"Unknown" WSO:** 99 meets (100%) missing coordinates - likely also need WSO assignment

### Example: Bham Slam 2025

```
Meet: Bham Slam
Date: 2025-06-07
Address: 2424 4TH AVE S, BIRMINGHAM, Alabama, United States of America, 352332519
Coordinates: null, null  ← PROBLEM
WSO Geography: Alabama
Participants: 37
```

This meet has:
- ✅ Valid address
- ✅ WSO geography assigned
- ❌ **No coordinates** → Excluded from analytics

## Impact Assessment

### Affected Metrics
All WSO analytics that depend on geometric filtering:
- `active_lifters_count` - Returns 0 when no meets have coordinates
- `recent_meets_count` - Undercounts by excluding meets without coordinates  
- `total_participations` - Undercounts significantly
- `barbell_clubs_count` - Indirectly affected (clubs linked to meets)

### Affected WSOs (Top Issues)
1. **Unknown** - 99/99 meets (100%) - Needs WSO assignment + geocoding
2. **Alabama** - 1/1 meets (100%) - Needs geocoding
3. **New England** - 8/14 meets (57%) - Needs geocoding
4. **Texas-Oklahoma** - 10/32 meets (31%) - Needs geocoding
5. **Ohio** - 4/13 meets (31%) - Needs geocoding
6. **Florida** - 8/35 meets (23%) - Needs geocoding

### Data Quality Stats
- **37 meets** have addresses → Can be geocoded automatically
- **96 meets** have NO address → Require manual data entry or scraping
- **10 WSOs** have 100% coordinate coverage (working correctly)

## Solutions Implemented

### 1. Investigation Scripts Created

**scripts/analytics/debug-alabama-calculation.js**
- Deep dive into Alabama WSO calculation
- Shows step-by-step why meets are excluded
- Tests geometric filtering with actual data

**scripts/analytics/check-specific-meet.js**
- Check individual meets by name
- Shows coordinate status and boundary testing
- Identifies lat/lng swap issues

**scripts/analytics/analyze-missing-coordinates.js**
- System-wide analysis of missing coordinates
- Per-WSO breakdown of data quality
- Impact assessment and recommendations

**scripts/geographic/validate-wso-territories.js**
- Validates all WSOs have valid `territory_geojson`
- Can be added to GitHub Actions CI/CD
- Exit code 1 if issues found

**scripts/geographic/import-wso-territories.js**
- Batch import of WSO territory GeoJSON files
- Created but not needed (all WSOs already have valid boundaries)

### 2. Documentation Fixed

**scripts/schema/add-wso-analytics-columns.sql**
- Fixed 3 column comments: "past 2 years" → "past 12 months"
- Now matches actual implementation

**.github/workflows/weekly-data-processing.yml**
- Fixed workflow description: "past 2 years" → "past 12 months"
- Ensures consistency across documentation

## Action Items to Fix Alabama (and Other WSOs)

### Immediate Fix (Alabama + 36 other meets)

```bash
# 1. Run geocoding for meets with addresses
node scripts/geographic/geocode-and-import.js

# 2. Verify coordinates were added
node scripts/analytics/check-specific-meet.js "Bham Slam"

# 3. Re-run analytics calculation
node scripts/analytics/wso-weekly-calculator.js

# 4. Verify Alabama now shows correct count
node scripts/analytics/debug-alabama-calculation.js
```

**Expected Result:** Alabama `active_lifters_count` increases from 0 to ~15-40 lifters

### Long-term Fix (96 meets without addresses)

These require either:
1. **Address Scraping** - Enhance `meet-address-scraper.js` to capture missing addresses
2. **Manual Data Entry** - Add addresses to database manually
3. **Geocoding Enhancement** - Use meet name + city to geocode without full address

### Preventive Measures

**Add to GitHub Actions (`.github/workflows/weekly-data-collection.yml`):**

```yaml
- name: Validate coordinate coverage
  run: |
    echo "Checking for meets with missing coordinates..."
    node scripts/analytics/analyze-missing-coordinates.js --summary
    
    # Warn if coordinate coverage drops below 80%
    if [ $coverage -lt 80 ]; then
      echo "⚠️ Warning: Coordinate coverage is ${coverage}%"
    fi
```

## Key Learnings

1. **The calculation logic is correct** - No code changes needed in `wso-weekly-calculator.js`
2. **The GeoJSON boundaries are valid** - All 26 WSOs have proper territory definitions
3. **The issue is data quality** - Missing coordinates exclude meets from analytics
4. **Geometric filtering requires coordinates** - This is by design and correct behavior
5. **29% of meets are invisible to analytics** - Significant data quality issue

## Files Modified

- ✅ `scripts/schema/add-wso-analytics-columns.sql` - Documentation fix
- ✅ `.github/workflows/weekly-data-processing.yml` - Documentation fix
- ✅ Created 5 new diagnostic/validation scripts
- ✅ Created this investigation summary document

## Next Steps

1. **Run geocoding** to populate 37 meets with addresses
2. **Investigate "Unknown" WSO** - 99 meets need WSO assignment
3. **Enhance address scraping** to prevent future missing addresses
4. **Add coordinate validation** to GitHub Actions workflow
5. **Document geocoding process** for regular maintenance

## Conclusion

**Alabama WSO is working correctly.** The 0 count is accurate based on available data - there are no meets with coordinates in the past 12 months. The actual problem is upstream: meets are missing geocoded coordinates that would allow them to be included in analytics.

**Fix:** Geocode the meets → Analytics will automatically update correctly.
