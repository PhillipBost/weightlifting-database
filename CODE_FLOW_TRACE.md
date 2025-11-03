# Code Flow Trace: Event Import to Database Insertion

**Investigation Date:** 2025-11-01
**Purpose:** Trace execution path to find phantom duplicate bug

---

## Execution Flow

### 1. Orchestrator: `iwf-main.js` (Line 435-599)

```javascript
async function main() {
    // Line 454: Get events to process
    const eventsToProcess = getEventsToProcess(args);

    // Line 494: Process each event in SEQUENTIAL loop
    for (let i = 0; i < eventsToProcess.length; i++) {
        const event = eventsToProcess[i];

        // Line 497: Process single event
        const result = await processEvent(event, i, eventsToProcess.length, importOptions);

        // Line 522: Delay between events
        await new Promise(resolve => setTimeout(resolve, EVENT_DELAY_MS));
    }
}
```

**Analysis:**
- ✓ Events processed sequentially (not parallel)
- ✓ Each event gets unique `event` object
- ⚠️ **POTENTIAL BUG**: `importOptions` is shared across all iterations
  - If `importOptions` is modified during import, could affect next event

---

### 2. Process Event: `iwf-main.js` (Line 387-414)

```javascript
async function processEvent(event, index, total, options = {}) {
    // Line 394: Call importer with event data
    const summary = await importEventToDatabase(
        event.event_id,    // ✓ Unique per event
        event.year,        // ✓ Unique per event
        event.date,        // ✓ Unique per event
        options            // ⚠️ Shared object
    );
}
```

**Analysis:**
- ✓ `event.event_id` correctly passed
- ⚠️ `options` object passed by reference (could be mutated)

---

### 3. Import Event: `iwf-database-importer.js` (Line 109-292)

```javascript
async function importEventToDatabase(eventId, year, eventDate, options = {}) {
    // Line 177: Scrape event results
    const scraperResult = await runScraper(eventId, year, eventDate, meetMetadata?.endpoint || null);

    // Line 183-185: Get results from scraper
    const mensResults = scraperResult.mens_weight_classes;
    const womensResults = scraperResult.womens_weight_classes;

    // Line 205: Upsert meet record
    const meet = await meetManager.upsertIWFMeet(meetMetadata);

    // Line 217-226: Import results ⚠️ CRITICAL SECTION
    const importStats = await resultsImporter.importMeetResults(
        mensResults,
        womensResults,
        meet.db_meet_id,      // ✓ Correct meet ID from upsert
        {
            Meet: meet.Meet,
            Date: meet.Date,
            Level: meet.Level,
            iwf_meet_id: meet.iwf_meet_id  // ✓ IWF event ID included
        },
        options
    );
}
```

**Analysis:**
- ✓ Scraper called with correct `eventId`
- ✓ Meet upserted before results import
- ✓ `meet.db_meet_id` passed to results importer
- ⚠️ **POTENTIAL BUG**: If scraper caches results or returns wrong data
- ⚠️ **POTENTIAL BUG**: If `meetManager.upsertIWFMeet` returns wrong db_meet_id

---

### 4. Run Scraper: `iwf-database-importer.js` (Line 65-93)

```javascript
async function runScraper(eventId, year, eventDate, endpoint) {
    // Line 71: Import scraper module
    const scraper = require('./iwf-results-scraper');

    // Line 75: Initialize browser
    await scraper.initBrowser();

    // Line 78: Scrape event results
    const result = await scraper.scrapeEventResults(eventId, year, eventDate, endpoint);

    // Line 81: Close browser
    await scraper.closeBrowser();
}
```

**Analysis:**
- ⚠️ **POTENTIAL BUG**: `require('./iwf-results-scraper')` imports module once
  - Module-level variables (browser, page) could persist between calls
  - If browser not properly closed, state could contaminate next event

---

### 5. Scraper: `iwf-results-scraper.js` (Line 91-114, 612-711)

```javascript
// MODULE-LEVEL VARIABLES ⚠️
let browser = null;  // ⚠️ SHARED STATE
let page = null;     // ⚠️ SHARED STATE

async function initBrowser() {
    browser = await puppeteer.launch({...});
    page = await browser.newPage();
}

async function scrapeEventResults(eventId, year, eventDate, endpoint) {
    // Line 632-641: Build event URL
    let eventUrl;
    if (endpoint) {
        eventUrl = config.buildEventDetailURLFromEndpoint(eventId, endpoint);
    } else {
        eventUrl = config.buildEventDetailURL(eventId, year, eventDate);
    }

    // Line 649: Navigate to event page
    await page.goto(eventUrl, {...});

    // ... extract results ...

    return result;
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
    }
}
```

**Analysis:**
- ⚠️ **CRITICAL BUG CANDIDATE**: Module-level `browser` and `page` variables
- ⚠️ Browser initialized ONCE per import run, not per event
- ⚠️ If `closeBrowser()` fails or isn't called, page state persists
- ⚠️ If navigation doesn't complete, previous page content could be read

**Test:** Check if browser is reinitialized between events in `runScraper()`
- Line 75: `await scraper.initBrowser()` - called every event ✓
- Line 81: `await scraper.closeBrowser()` - called every event ✓
- **BUT**: Module-level variables mean browser/page references persist

---

### 6. Meet Upsert: `iwf-meet-manager.js` (Line 104-171)

```javascript
async function upsertIWFMeet(meetData) {
    const insertData = {
        iwf_meet_id: meetData.event_id.toString(),  // ✓ Correct event ID
        meet: meetData.Meet || null,
        // ... other fields ...
    };

    // Line 124: Check if meet exists
    const existingMeet = await findExistingMeet(meetData.event_id);

    // Line 128-133: Upsert with conflict resolution
    await config.supabaseIWF
        .from('iwf_meets')
        .upsert(insertData, {
            onConflict: 'iwf_meet_id',  // ✓ Correct conflict key
            ignoreDuplicates: false
        });

    // Line 136-140: Fetch back the record
    const { data: upsertedMeet } = await config.supabaseIWF
        .from('iwf_meets')
        .select('*')
        .eq('iwf_meet_id', meetData.event_id.toString())
        .maybeSingle();

    return {
        db_meet_id: upsertedMeet.db_meet_id,  // ✓ Returns database PK
        iwf_meet_id: upsertedMeet.iwf_meet_id,
        // ...
    };
}
```

**Analysis:**
- ✓ Upsert logic looks correct
- ✓ Uses `iwf_meet_id` for conflict detection
- ⚠️ **POTENTIAL RACE CONDITION**: If two events processed too quickly:
  1. Event A upserts → creates db_meet_id 671
  2. Event B upserts before A completes → might get db_meet_id 671?

**Test:** Check if `onConflict: 'iwf_meet_id'` works correctly
- If constraint exists, should update existing record
- If constraint missing, could create duplicate records

---

### 7. Results Import: `iwf-results-importer.js` (Line 438-525)

```javascript
async function importMeetResults(mensWeightClasses, womensWeightClasses, meetId, meetInfo, options = {}) {
    // Line 488-493: Import men's results
    combinedSummary.mens = await batchImportResults(
        mensToImport,
        meetId,      // ✓ Passed correctly
        meetInfo,    // ✓ Passed correctly
        options
    );

    // Line 497-503: Import women's results
    combinedSummary.womens = await batchImportResults(
        womensToImport,
        meetId,      // ✓ Passed correctly
        meetInfo,    // ✓ Passed correctly
        options
    );
}
```

**Analysis:**
- ✓ `meetId` passed correctly to batch importer
- ✓ Separate calls for men's and women's results
- ✓ No obvious variable sharing issues

---

### 8. Batch Import: `iwf-results-importer.js` (Line 345-425)

```javascript
async function batchImportResults(athletes, meetId, meetInfo, options = {}) {
    for (let i = 0; i < athletes.length; i++) {
        const athlete = athletes[i];

        // Line 375: Import single athlete
        const importResult = await importAthleteResult(athlete, meetId, meetInfo);

        // ... track stats ...
    }
}
```

**Analysis:**
- ✓ Sequential processing
- ✓ `meetId` passed to each athlete import
- ✓ No closure/scope issues visible

---

### 9. Import Athlete: `iwf-results-importer.js` (Line 292-334)

```javascript
async function importAthleteResult(athlete, meetId, meetInfo) {
    // Line 295-302: Find or create lifter
    const lifter = await lifterManager.findOrCreateLifter(...);

    // Line 309: Map to result record
    const resultRecord = mapAthleteToResultRecord(enrichedAthlete, meetId, lifter, meetInfo);

    // Line 314: Insert result
    const insertResult = await insertResultRecord(resultRecord);
}
```

**Analysis:**
- ✓ `meetId` passed to mapper
- ✓ `meetInfo` passed to mapper

---

### 10. Map Result Record: `iwf-results-importer.js` (Line 128-150)

```javascript
function mapAthleteToResultRecord(athlete, meetId, lifter, meetInfo) {
    return {
        db_meet_id: meetId,                  // ✓ Uses meetId parameter
        db_lifter_id: lifter.db_lifter_id,
        meet_name: meetInfo.Meet || null,
        date: meetInfo.Date || null,
        // ... other fields ...
    };
}
```

**Analysis:**
- ✓ Correctly uses `meetId` parameter
- ✓ No variable shadowing
- ✓ No closure issues

---

## Bug Candidates (Ranked by Likelihood)

### 1. **HIGHEST**: Scraper Module State Contamination

**Evidence:**
- Module-level `browser` and `page` variables
- Browser initialized/closed per event, BUT variables persist
- If navigation or close fails, stale state affects next event

**Hypothesis:**
```
Event A:
  - initBrowser() → browser/page created
  - goto(eventA_url) → page loads Event A
  - extract results → Event A results
  - closeBrowser() → browser closed, BUT page variable still references old page

Event B:
  - initBrowser() → NEW browser/page created (old references lost)
  - goto(eventB_url) → SHOULD load Event B
  - IF goto() fails or cached → STILL SHOWS Event A content
  - extract results → Event A results AGAIN (phantom!)
  - Results get inserted with Event B's meetId → DUPLICATE!
```

**Test:**
- Add logging: `console.log('Navigating to:', eventUrl, 'Current URL:', await page.url())`
- Check if URL actually changes between events

---

### 2. **MEDIUM**: Race Condition in Meet Upsert

**Evidence:**
- Sequential processing should prevent this
- But if database constraint missing, duplicate db_meet_ids possible

**Hypothesis:**
```
Event A upserts meet → iwf_meet_id='661' → returns db_meet_id=671
Event B upserts meet → iwf_meet_id='661' → IF NO CONSTRAINT → creates db_meet_id=672
Both events scrape same results, insert under different db_meet_ids
```

**Test:**
- Query 1 in SQL script will reveal if duplicate iwf_meet_ids exist

---

### 3. **LOW**: Shared Options Object Mutation

**Evidence:**
- `options` passed by reference through entire chain
- Could be mutated somewhere

**Hypothesis:**
- Unlikely to cause phantom duplicates
- Would affect import behavior, not result data

---

## Next Steps

1. **RUN SQL QUERIES** to check database state
2. **ADD LOGGING** to scraper to verify URL navigation
3. **CHECK** if database has unique constraint on `iwf_meet_id`
4. **CREATE** reproduction test with two known phantom events
