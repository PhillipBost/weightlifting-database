# IWF Individual Attempts Extraction - Implementation Plan

## Status: ✅ STEP 1 COMPLETE - Expanded Results Located & Extracted

### What We've Done

1. **Located expanded results divs using XPath:**
   - Men's: `/html/body/div[4]/section/div[2]/div[2]/div[2]` (56 children)
   - Women's: `/html/body/div[4]/section/div[2]/div[2]/div[4]` (56 children)

2. **Modified `iwf-results-scraper.js`:**
   - Added `extractExpandedResults()` function to extract HTML from XPath locations
   - Added `saveExpandedResultsHTML()` function to save HTML for analysis
   - Added `parseAttemptHTML()` placeholder function
   - Integrated extraction calls into tab-clicking workflow
   - Updated module exports

3. **Tested on Event 661:**
   - Successfully navigated to event page
   - Successfully clicked men's tab → extracted expanded results (56 children)
   - Successfully clicked women's tab → extracted expanded results (56 children)
   - Saved HTML files for structure analysis:
     - `output\iwf_expanded_results_men_analysis.html`
     - `output\iwf_expanded_results_women_analysis.html`

### HTML Structure Found

The expanded results contain:
```html
<!-- Weight class header -->
<h3>60 kg Men</h3>

<!-- Lift type header -->
<p>Snatch</p>

<!-- Athlete cards with attempts -->
<div class="card">
  <div class="col-3">
    <!-- Attempt 1: successful -->
    <strong>133</strong>
    
    <!-- Attempt 2: successful -->
    <strong>138</strong>
    
    <!-- Attempt 3: missed (strikethrough) -->
    <strong><strike>127</strike></strong>
    
    <!-- No attempt -->
    <strong>---</strong>
  </div>
</div>

<!-- Later in same div -->
<p>Clean & Jerk</p>
<!-- More athlete cards with C&J attempts -->
```

### Data Format

Each attempt is marked as:
- **Successful**: `<strong>VALUE</strong>` → Store as positive number (e.g., `138`)
- **Missed**: `<strong><strike>VALUE</strike></strong>` → Store as negative number (e.g., `-127`)
- **No attempt**: `<strong>---</strong>` → Store as `null`

## Next Steps

### Step 2: Implement Proper Parser

The `parseAttemptHTML()` function needs to:

1. Parse HTML to identify weight classes (h3 tags)
2. For each weight class:
   - Find "Snatch" section and extract snatch_1/2/3
   - Find "Clean & Jerk" section and extract cj_1/2/3
3. Match extracted attempts to athlete cards (by name)
4. Return structured data for database import

### Step 3: Integrate with Database Import

Update `iwf-database-importer.js` to:
- Accept attempt data from scraper
- Store snatch_1/2/3 and cj_1/2/3 in meet_results table
- Calculate analytics (bounce-back, success rates, etc.)

### Step 4: Test End-to-End

Run full pipeline:
```bash
node scripts/production/iwf-results-scraper.js --event-id 661 --year 2025
# Verifies: extraction → parsing → structured output

node scripts/production/iwf-database-importer.js --event-id 661 --year 2025
# Verifies: import with attempt data into database
```

## Files Modified

- `scripts/production/iwf-results-scraper.js` - Added extraction functions and integration

## Files To Create/Modify Next

- `scripts/production/iwf-database-importer.js` - Add attempt data import logic
- Database schema updates if needed for new fields

## Key Insights

1. Individual attempts ARE displayed on IWF site - they're just in a separate DOM section
2. Tab clicking works perfectly - CSS classes update correctly
3. XPath selectors are reliable for locating expanded results
4. HTML structure is consistent across weight classes and genders
5. Strikethrough tag (`<strike>`) indicates missed attempt - not just styling!
