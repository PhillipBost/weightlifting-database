# Root Cause Analysis: Phantom Duplicate Records

**Investigation Date:** 2025-11-01
**Data Corruption Date:** 2025-10-29
**Total Phantom Records:** 19,052 (8,800 groups)
**Status:** ROOT CAUSE IDENTIFIED

---

## Critical Evidence

### 1. Timing Analysis - Same-Day Batch Imports

**All 19,052 phantom records created on 2025-10-29 in coordinated batches**

| Batch | Records | Time Window | Duration |
|-------|---------|-------------|----------|
| Batch 1 | 155 records | 19:17:44 - 19:18:46 | 1.02 minutes |
| Batch 2 | 160 records | 20:02:33 - 20:03:46 | 1.21 minutes |
| Batch 3 | 202 records | 19:47:21 - 19:48:42 | 1.35 minutes |
| Batch 4 | 240 records | 19:22:37 - 19:24:10 | 1.56 minutes |
| Batch 5 | 170 records | 20:32:29 - 20:33:45 | 1.27 minutes |
| Batch 6 | 190 records | 20:44:52 - 20:46:03 | 1.18 minutes |

**Key Finding:** Each batch has **EXACTLY TWO MEETS** being imported simultaneously with identical timestamps

### 2. Problematic Meet Pairs - Systematic Pattern

**Every duplicate pair was imported in the SAME ORCHESTRATOR RUN**

```
Meet Pair 1: db_meet_id 671 ↔ 672
  671: 2nd UNIVERSITY WORLD CUP (May 1, 1999)
  672: 31st JUNIOR WORLD CHAMPS (May 17, 2005)
  >>> Impossible: 1999 results CANNOT appear in 2005 event

Meet Pair 2: db_meet_id 652 ↔ 653
  652: 73rd WORLD CHAMPS (Nov 14, 2003)
  653: XXVIII OLYMPICS (Aug 14, 2004)
  >>> Impossible: Athletes with identical lifts in two different years

Meet Pair 3: db_meet_id 785 ↔ 788
  785: PACIFIC GAMES (Sep 5, 2011)
  788: YOUTH OLYMPIC QUAL (May 18, 2010)
  >>> Impossible: Time runs BACKWARDS (2011 → 2010)
```

### 3. Performance Data is PERFECTLY IDENTICAL

```
Pair 671/672, Athlete "Mohammed Abdulmunem Ali AL-SHARUEE":

Record 77451 (db_meet_id 671):
  snatch: 0/0/0 = 120
  clean&jerk: 0/0/0 = 135
  total: 255
  rank: 9
  created_at: 2025-10-29 15:17:47.983Z

Record 77495 (db_meet_id 672):
  snatch: 0/0/0 = 120
  clean&jerk: 0/0/0 = 135
  total: 255
  rank: 9
  created_at: 2025-10-29 15:17:50.238Z

>>> IDENTICAL DATA, DIFFERENT db_meet_id, 2-3 seconds later
```

---

## Root Cause Hypothesis

### Scenario: Event Discovery Duplication

The most likely cause is **event discovery incorrectly creating duplicate db_meet records for the same IWF event**:

1. **Event discovery script** (`iwf-event-discovery.js`) scrapes IWF.sport and finds events
2. **Deduplication failure** - the same event gets discovered TWICE with TWO DIFFERENT db_meet_ids:
   - First discovery creates db_meet_id 671 for IWF event ID X
   - Later discovery creates db_meet_id 672 ALSO for IWF event ID X  (due to pagination overlap, duplicate naming, or URL parsing bug)

3. **Import process** processes events sequentially:
   - Processes "event X" → calls scraper → gets event X's results → inserts under db_meet_id 671 ✓
   - Processes "event X" (duplicate entry) → calls scraper → gets event X's results AGAIN → inserts under db_meet_id 672 ✗

4. **Result:** Identical performance data appears under TWO different db_meet_ids

### Alternative Scenario: Scraper/Event ID Mismatch

Less likely, but possible:

1. **Event discovery correctly identifies events A and B with different event_ids**
2. **Orchestrator processes event A → scraper returns results for A → inserted correctly**
3. **Orchestrator processes event B → scraper RETURNS RESULTS FOR A INSTEAD**
   - Possible causes:
     - Scraper has cached state from previous run
     - Event ID parameter not passed correctly to scraper
     - Browser session state contamination

### Why This Happened on 2025-10-29

Someone likely:
- Ran `node scripts/production/iwf-main.js --year 2025` manually on 2025-10-29
- OR triggered the GitHub Actions monthly scraper workflow
- This caused event discovery to run and find 2025 events
- The discovery process had a BUG that created duplicate db_meet records
- All events for that year got imported, creating phantom duplicates for affected meets

---

## Specific Code Locations to Investigate

### 1. Event Discovery Deduplication (HIGHEST PRIORITY)

**File:** `scripts/production/iwf-event-discovery.js`

Search for:
- How events are deduplicated after scraping
- How event_ids are matched to prevent duplicates
- Pagination handling - does it skip events that were already found?
- Are there multiple endpoints (MODERN, MID_RANGE, HISTORICAL) that might overlap?

### 2. Event Loader Logic (HIGH PRIORITY)

**File:** `scripts/production/iwf-main.js`
**Function:** `loadEventsFromFile(year)`
**Lines:** ~170-214

Check:
- Does `iwf_events_YYYY.json` contain duplicates?
- When events are loaded, are they deduplicated?
- Could the same event_id appear twice in the events array?

### 3. Meet Manager Upsert Logic (MEDIUM PRIORITY)

**File:** `scripts/production/iwf-meet-manager.js`
**Function:** `upsertIWFMeet(meetData)`
**Lines:** ~104-171

Check:
- Does `iwf_meet_id` unique constraint actually prevent duplicates?
- When upserting, what happens if the same event_id is inserted twice rapidly?
- Is there any race condition with the upsert logic?

### 4. Scraper Caching/State (MEDIUM PRIORITY)

**File:** `scripts/production/iwf-results-scraper.js`

Check:
- Is browser state reused between events?
- Are results cached?
- Could a previous event's results leak into the next event?

---

## Prevention Strategy

1. **Add Event Deduplication Check**
   ```javascript
   // In event discovery, after loading all events:
   const eventIds = new Set();
   const duplicates = [];
   for (const event of allEvents) {
     if (eventIds.has(event.event_id)) {
       duplicates.push(event.event_id);
     }
     eventIds.add(event.event_id);
   }
   if (duplicates.length > 0) {
     throw new Error(`Duplicate event IDs found: ${duplicates.join(', ')}`);
   }
   ```

2. **Add Database Constraint**
   ```sql
   -- Add unique constraint on (iwf_meet_id) in iwf_meets table
   ALTER TABLE iwf_meets ADD CONSTRAINT unique_iwf_meet_id UNIQUE(iwf_meet_id);
   ```

3. **Add Import Validation**
   - Before importing, verify event_id exists and is unique
   - Verify scraper returns results for the CORRECT event_id
   - Log event_id → db_meet_id mapping for debugging

---

## Next Steps

1. **Immediate:** Read the `iwf_events_*.json` files from 2025-10-29 to see if they contain duplicate events
2. **High Priority:** Search event discovery code for deduplication logic
3. **High Priority:** Check `iwf-main.js` to see how events are loaded from JSON
4. **Medium Priority:** Review scraper state management
5. **Long-term:** Implement prevention measures above
