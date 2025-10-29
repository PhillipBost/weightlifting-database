# IWF Individual Attempts Integration - Summary

## What We've Accomplished

### ✅ Phase 1: Data Discovery & Extraction (COMPLETE)

1. **Located Individual Attempt Data**
   - Men's expanded results: XPath `/html/body/div[4]/section/div[2]/div[2]/div[2]`
   - Women's expanded results: XPath `/html/body/div[4]/section/div[2]/div[2]/div[4]`
   - Both divs contain 56+ child elements with athlete data

2. **Created Extraction Infrastructure**
   - Modified `iwf-results-scraper.js` with extraction functions:
     - `extractExpandedResults(page, xpathSelector, gender)` - Extracts HTML from XPath
     - `saveExpandedResultsHTML(gender, htmlContent)` - Saves for analysis
     - `parseAttemptHTML(htmlContent, gender)` - Placeholder for parsing
   - Successfully tested on event 661
   - Generated output files:
     - `output/iwf_expanded_results_men_analysis.html` (1.9M)
     - `output/iwf_expanded_results_women_analysis.html` (1.9M)

3. **Analyzed HTML Structure**
   - Weight class headers: `<h3>60 kg Men</h3>`
   - Lift type sections: `<p>Snatch</p>`, `<p>Clean & Jerk</p>`
   - Individual attempt format:
     - Successful: `<strong>133</strong>` → 133
     - Missed: `<strong><strike>127</strike></strong>` → -127
     - No attempt: `<strong>---</strong>` → null

### ⏳ Phase 2: Integration with `iwf-database-importer.js` (PENDING)

The goal is to integrate the extraction into the main import pipeline so that:
1. When scraping event results, individual attempts are automatically extracted
2. Athlete data includes snatch_lift_1/2/3 and cj_lift_1/2/3 fields
3. Data flows through to database import

## Current State

- `iwf-results-scraper.js`: Ready with extraction functions ✅
- `iwf-database-importer.js`: Needs integration (reverted to clean state)
- `iwf-main.js`: Unchanged (uses iwf-database-importer.js internally)

## Next Steps for Integration

### Option 1: Quick Integration (Recommended)
Add to `iwf-database-importer.js` after the existing `extractWeightClassResults()` calls:

```javascript
// After each tab is clicked and results extracted:
if (mensWeightClasses?.weight_classes?.[0]?.athletes) {
    const attempts = await extractExpandedResults(page, '/html/body/div[4]/section/div[2]/div[2]/div[2]', 'male');
    // Merge attempts data with athlete objects
}
```

### Option 2: Refactor for Reusability
Create `iwf-attempt-extractor.js` module to handle all parsing logic, then import into both:
- `iwf-results-scraper.js`
- `iwf-database-importer.js`

## Testing the Integration

Once integrated, test with:
```bash
node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 10
```

Or run importer directly:
```bash
node scripts/production/iwf-database-importer.js --event-id 661 --year 2025 --date "2025-10-02" --force
```

## Key Implementation Notes

1. **XPath Access in Puppeteer**:
   ```javascript
   const element = await page.evaluate((xpath) => {
       return document.evaluate(xpath, document, null, 
           XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
   }, xpathSelector);
   ```

2. **Attempt Parsing**:
   - Look for `<strong>VALUE</strong>` patterns
   - Check for `<strike>` tags inside to detect misses
   - Return `null` for "---" (no attempt made)
   - Store negative values for missed attempts

3. **Athlete Matching**:
   - Extract athlete names from expanded results
   - Match to athletes from card data by name (normalize case)
   - Merge snatch_1/2/3 and cj_1/2/3 into athlete objects

## Files Created/Modified

### Modified:
- `scripts/production/iwf-results-scraper.js` - Added extraction functions

### Created:
- `scripts/production/EXTRACTION_PLAN.md` - Detailed implementation roadmap
- `scripts/production/INTEGRATION_SUMMARY.md` - This file

## Next Action

When ready to integrate into `iwf-database-importer.js`, contact me and I'll:
1. Add the import statement for iwf-results-scraper
2. Create a clean integration function
3. Inject it into the scraping workflow
4. Test end-to-end

The extraction functions are already tested and working - they just need to be wired into the main pipeline.
