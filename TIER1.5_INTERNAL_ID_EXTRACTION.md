# Tier 1.5: Internal ID Extraction via Row Clicking

## Problem

The previous implementation tried to extract internal_ids during Tier 1 verification by clicking ALL rows on the rankings page. This had two issues:

1. **"One-way street" problem**: After clicking one row, other rows became unclickable
2. **Wrong approach**: Tried to capture URLs without actually navigating, which didn't work

## Solution

Moved internal_id extraction to a separate **Tier 1.5** step that runs BETWEEN Tier 1 and Tier 2:

### New Workflow

1. **Tier 1**: Scrape rankings page, extract data (national_rank, club, etc.) - NO clicking
2. **Tier 1.5** (NEW): If athlete found in Tier 1 but missing internal_id, click ONLY their row to extract it
3. **Tier 2**: If athlete not found in Tier 1, use Sport80 search

### Key Changes

#### 1. Removed Broken Clicking Logic from Tier 1

**File**: `scripts/production/database-importer-custom.js`

**Before** (lines 380-510):
- Tried to click ALL rows during Tier 1 scraping
- Used Vue.js router interception (didn't work)
- Only extracted 1 out of 30 internal_ids

**After**:
- Tier 1 focuses ONLY on scraping rankings data
- No clicking during Tier 1
- Clean separation of concerns

#### 2. Added Tier 1.5 Step

**Location**: After Tier 1 verification succeeds (line ~660)

**Logic**:
```javascript
if (targetAthlete found in Tier 1 && !targetAthlete.internalId) {
    // Tier 1.5: Extract internal_id by clicking
    extractedId = await extractInternalIdByClicking(
        page, divisionCode, startDate, endDate, lifterName
    );
}
```

#### 3. Added `extractInternalIdByClicking` Function

**Location**: Tier 1 helper functions section (line ~270)

**How it works**:
1. Loads rankings page fresh
2. Searches for target athlete across all pages
3. When found, clicks ONLY their row
4. Waits for navigation to member page
5. Extracts internal_id from URL
6. Returns the ID (no need to navigate back - we're done with this page)

**Key features**:
- Searches across multiple pages if needed
- Only clicks ONE row (the target athlete)
- Uses actual navigation (not Vue.js interception)
- Clean, simple approach

## Benefits

### 1. Tier 1 Stays Fast and Reliable
- Scrapes all rankings data without clicking
- Extracts national_rank, club, WSO, etc. for ALL athletes
- No risk of breaking due to clicking issues

### 2. Tier 1.5 is Targeted and Efficient
- Only runs when needed (athlete found but missing internal_id)
- Only clicks ONE row per athlete
- Fresh page load = no "one-way street" problem

### 3. Better Separation of Concerns
- Tier 1: Bulk data extraction
- Tier 1.5: Targeted internal_id extraction
- Tier 2: Fallback verification

## Expected Output

### Before (Broken)
```
🔗 Extracting internal_ids from 30 clickable rows...
✅ Dakota Carlson: internal_id 30112
❌ Mark Shockley: could not extract internal_id
❌ Richard Redus: could not extract internal_id
... (29 failures)
```

### After (Fixed)
```
✅ Tier 1 VERIFIED: "Trevor Kimm" found in division rankings
🔗 Tier 1.5: Extracting internal_id for "Trevor Kimm" via row clicking...
   🌐 Loading rankings page for clicking...
   ✅ Found "Trevor Kimm" on page 1
   🖱️ Clicking row...
✅ Tier 1.5: Extracted internal_id 12345
```

## Testing

To test the fix:
```powershell
$env:DRY_RUN="false"; $env:MAX_GAPS="1"; node scripts\maintenance\scrape-missing-meet-ids-fixed.js
```

Expected behavior:
1. Tier 1 scrapes rankings and extracts data for all athletes
2. Tier 1.5 extracts internal_id for the target athlete by clicking their row
3. Internal_id is used for disambiguation or stored in database
4. Process continues smoothly

## Files Modified

- `scripts/production/database-importer-custom.js`
  - Removed broken clicking logic from `scrapeDivisionRankings` (lines 380-510)
  - Added `extractInternalIdByClicking` function (line ~270)
  - Added Tier 1.5 step after Tier 1 verification (line ~660)
