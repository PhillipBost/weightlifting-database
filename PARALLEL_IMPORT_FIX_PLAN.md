# Parallel Import Race Condition Fix Plan

**Status:** Ready for Implementation
**Root Cause:** Running multiple import scripts simultaneously caused CDN cache collisions
**Impact:** 19,052 phantom duplicate records created 2025-10-29
**Solution:** Three-layered protection (lock files, cache-busting headers, documentation)

---

## ROOT CAUSE ANALYSIS

### What Happened
User ran multiple import year scripts in parallel:
```bash
node iwf-main.js --year 1999 &
node iwf-main.js --year 2005 &
node iwf-main.js --year 2010 &
```

### CDN Cache Collision Mechanism
1. Process A requests event_id=315 at 15:22:34.835
2. IWF CDN caches response for ~5 seconds
3. Process B requests event_id=5 at 15:22:35.350 (0.5 seconds later)
4. **CDN serves cached response from event_id=315** (same IP, same endpoint, within cache window)
5. Process B parses event 315's HTML, inserts data under db_meet_id=672
6. Result: Event 315's data in database under TWO meets (671 and 672)

### Evidence from Database
Query 2 results showed:
- db_meet_id 671: iwf_meet_id=315 (event 315)
- db_meet_id 672: iwf_meet_id=5 (event 5)
- **But identical results in both meets** (proves CDN cache contamination)

---

## THREE-LAYERED SOLUTION

### LAYER 1: Lock File Mechanism (Prevent Parallel Execution)

**File:** `scripts/production/iwf-lock-manager.js` (NEW)

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_DIR = path.join(os.tmpdir(), 'iwf-imports');
const LOCK_FILE = path.join(LOCK_DIR, 'iwf-import.lock');
const LOCK_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

class LockManager {
  static ensureLockDir() {
    if (!fs.existsSync(LOCK_DIR)) {
      fs.mkdirSync(LOCK_DIR, { recursive: true });
    }
  }

  static acquireLock() {
    this.ensureLockDir();

    // Check if lock exists
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const lockAge = Date.now() - lockData.timestamp;

      if (lockAge < LOCK_TIMEOUT) {
        throw new Error(
          `IWF import already running (PID ${lockData.pid}). ` +
          `Lock acquired at ${new Date(lockData.timestamp).toISOString()}. ` +
          `\nRunning parallel imports causes CDN cache collisions!\n` +
          `Please wait for the first import to complete.`
        );
      } else {
        console.log('Removing stale lock file (> 4 hours old)');
        fs.unlinkSync(LOCK_FILE);
      }
    }

    // Create lock file
    const lockData = {
      pid: process.pid,
      timestamp: Date.now(),
      hostname: os.hostname(),
      command: process.argv.slice(2).join(' ')
    };

    fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
    console.log(`✓ Lock acquired (PID ${process.pid})`);
  }

  static releaseLock() {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
      console.log('✓ Lock released');
    }
  }
}

module.exports = LockManager;
```

**Update:** `scripts/production/iwf-main.js` (lines ~435-445)

```javascript
const lockManager = require('./iwf-lock-manager');

async function main() {
  const startTime = Date.now();

  try {
    // Acquire lock at start
    lockManager.acquireLock();

    ensureDirectories();
    // ... rest of main() ...

  } catch (error) {
    // ... error handling ...
  } finally {
    // ALWAYS release lock
    lockManager.releaseLock();
  }
}
```

---

### LAYER 2: Cache-Busting Headers & URL Verification

**Update:** `scripts/production/iwf-results-scraper.js` (lines ~630-660)

```javascript
async function scrapeEventResults(eventId, year = null, eventDate = null, endpoint = null) {
    log('\n' + '='.repeat(80));
    log(`SCRAPING EVENT: ${eventId}`);
    log('='.repeat(80));

    // ... build eventUrl ...

    try {
        log(`Event URL: ${eventUrl}`);

        // Set cache-busting headers BEFORE navigation
        await page.setExtraHTTPHeaders({
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Request-ID': `event-${eventId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            'X-IWF-Event-ID': eventId
        });

        log(`Cache-busting headers set for event ${eventId}`);

        // Navigate with explicit cache control
        await retryOperation(async () => {
            await page.goto(eventUrl, {
                waitUntil: 'networkidle0',
                timeout: config.TIMING.REQUEST_TIMEOUT_MS
            });
        }, config.RETRY.NETWORK_REQUESTS, `navigate to event ${eventId}`);

        log('Page loaded successfully');

        // *** VERIFY URL ACTUALLY CHANGED ***
        const currentUrl = await page.url();
        log(`Current URL after navigation: ${currentUrl}`);

        // Extract event_id from current URL
        const urlEventIdMatch = currentUrl.match(/event_id=(\d+)/);
        const currentEventId = urlEventIdMatch ? urlEventIdMatch[1] : null;

        if (currentEventId !== eventId) {
            const errorMsg =
                `URL mismatch after navigation!\n` +
                `Expected event_id: ${eventId}\n` +
                `Actual event_id: ${currentEventId}\n` +
                `Current URL: ${currentUrl}\n` +
                `This indicates CDN cache contamination. Retrying...`;

            log(errorMsg, 'ERROR');
            throw new Error(errorMsg);
        }

        log(`✓ URL verified: event_id=${eventId} matches`);

        // Continue with rest of scraping...
        result.navigation_success = true;

    } catch (error) {
        log(`Navigation error: ${error.message}`, 'ERROR');
        throw error;
    }
}
```

**Update:** `scripts/production/iwf-config.js` (increase inter-event delay)

```javascript
TIMING: {
    // ... other timings ...
    EVENT_DELAY_MS: 5000,  // Increased from 2000 to 5000 (allow CDN cache expiry)
    PAGE_LOAD_DELAY_MS: 3000,
    // ...
}
```

---

### LAYER 3: Documentation & Validation

**File:** `CLAUDE.md` (Add section after "## IWF Database - YTD Backfill")

```markdown
## CRITICAL: Parallel Import Prevention

**⚠️ NEVER run multiple IWF import processes simultaneously.**

Running parallel imports causes CDN cache collisions where the IWF website
serves stale cached data, resulting in phantom duplicate records being inserted
into the database under different meets.

### What Went Wrong (2025-10-29 Incident)
- User ran: `node iwf-main.js --year 1999 &` and `node iwf-main.js --year 2005 &`
- CDN cached event 315's results
- Event 5 request returned cached event 315 data
- Same results inserted under two different meets
- Created 19,052 phantom duplicate records

### Correct Usage

**✓ CORRECT (Sequential):**
```bash
node iwf-main.js --year 1999
node iwf-main.js --year 2000
node iwf-main.js --year 2001
```

**✓ CORRECT (With script loop):**
```bash
for year in 1999 2000 2001 2002 2003; do
    node iwf-main.js --year $year
    echo "Waiting for next import..."
    sleep 5
done
```

**✗ WRONG (Parallel background processes):**
```bash
node iwf-main.js --year 1999 &
node iwf-main.js --year 2005 &
wait
```

**✗ WRONG (Concurrent invocations):**
```bash
node iwf-main.js --year 1999 & \
node iwf-main.js --year 2000 & \
wait
```

### Safeguards in Place
- Lock file prevents concurrent execution
- Cache-busting headers prevent CDN caching
- URL verification detects cache misses
- 5-second inter-event delay allows cache expiry
```

**File:** `scripts/maintenance/validate-no-parallel-runs.js` (NEW)

```javascript
#!/usr/bin/env node
/**
 * Validate that no parallel IWF import processes are running
 *
 * Usage: node validate-no-parallel-runs.js
 * Exit code: 0 if safe, 1 if parallel run detected
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const LOCK_FILE = path.join(os.tmpdir(), 'iwf-imports', 'iwf-import.lock');

function checkParallelRuns() {
  console.log('Checking for parallel IWF import processes...\n');

  // Check lock file
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const lockAge = Date.now() - lockData.timestamp;
      const lockAgeMins = (lockAge / 1000 / 60).toFixed(1);

      console.error(`❌ IWF import is already running!`);
      console.error(`   PID: ${lockData.pid}`);
      console.error(`   Started: ${new Date(lockData.timestamp).toISOString()}`);
      console.error(`   Age: ${lockAgeMins} minutes`);
      console.error(`   Command: ${lockData.command}\n`);
      console.error('Please wait for the current import to complete.');

      return false;
    } catch (e) {
      console.warn('Warning: Could not read lock file');
    }
  }

  // Check process list for multiple iwf-main.js processes
  try {
    let psCommand = 'ps aux | grep "iwf-main.js"';
    if (os.platform() === 'win32') {
      psCommand = 'tasklist | findstr "node"';
    }

    const processes = execSync(psCommand, { encoding: 'utf-8' });
    const iwfProcesses = processes.split('\n')
      .filter(line => line.includes('iwf-main.js') && !line.includes('grep'))
      .filter(line => line.trim());

    if (iwfProcesses.length > 1) {
      console.error(`❌ Multiple IWF import processes detected!\n`);
      iwfProcesses.forEach(proc => console.error(`   ${proc}`));
      return false;
    }
  } catch (e) {
    // Process list check failed, but lock file check above is sufficient
  }

  console.log('✓ No parallel imports running');
  return true;
}

const isValid = checkParallelRuns();
process.exit(isValid ? 0 : 1);
```

**Update:** `.github/workflows/monthly-iwf-scraper.yml`

```yaml
name: Monthly IWF Scraper

on:
  schedule:
    - cron: '0 2 1 * *'  # 1st of month at 2 AM UTC
  workflow_dispatch:
    inputs:
      year:
        description: 'Year to scrape (default: current year)'
        required: false
        type: string

# CRITICAL: Prevent parallel workflow runs
concurrency:
  group: iwf-scraper
  cancel-in-progress: false  # Queue instead of cancel

jobs:
  scrape-iwf:
    runs-on: ubuntu-latest
    timeout-minutes: 120  # Increased from 60

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Validate no parallel imports
        run: node scripts/maintenance/validate-no-parallel-runs.js

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      # ... rest of workflow ...
```

---

## IMPLEMENTATION CHECKLIST

### Phase 1: Lock File Protection
- [ ] Create `iwf-lock-manager.js`
- [ ] Update `iwf-main.js` to acquire/release locks
- [ ] Test lock prevents parallel execution
- [ ] Test lock releases on error

### Phase 2: Cache-Busting
- [ ] Update `iwf-results-scraper.js` with cache headers
- [ ] Add URL verification after navigation
- [ ] Increase `EVENT_DELAY_MS` to 5000
- [ ] Test scraper with rapid sequential imports

### Phase 3: Documentation
- [ ] Add warning to `CLAUDE.md`
- [ ] Create `validate-no-parallel-runs.js`
- [ ] Update GitHub Actions workflow
- [ ] Add concurrency settings

### Phase 4: Testing
- [ ] Manual test: try running two imports simultaneously (should fail gracefully)
- [ ] Manual test: sequential imports work correctly
- [ ] Manual test: cache headers included in requests
- [ ] GitHub Actions: verify workflow queues instead of cancels

### Phase 5: Cleanup (Separate PR)
- [ ] Delete 19,052 phantom records (using cleanup strategy)
- [ ] Re-import affected years sequentially
- [ ] Verify no new duplicates created

---

## COMMANDS TO IMPLEMENT

```bash
# After context clear, implement all changes:

# 1. Create lock manager
echo "Creating lock manager..."

# 2. Update iwf-main.js

# 3. Update iwf-results-scraper.js

# 4. Update iwf-config.js EVENT_DELAY_MS

# 5. Create validation script

# 6. Update CLAUDE.md

# 7. Update GitHub Actions workflow

# 8. Test lock mechanism
node iwf-main.js --year 2025 &
sleep 1
node iwf-main.js --year 2024  # Should fail with lock error

# 9. Test sequential import
node iwf-main.js --year 2024
node iwf-main.js --year 2025
```

---

## FILES TO MODIFY/CREATE

### New Files:
1. `scripts/production/iwf-lock-manager.js`
2. `scripts/maintenance/validate-no-parallel-runs.js`

### Modified Files:
1. `scripts/production/iwf-main.js` - Add locking
2. `scripts/production/iwf-results-scraper.js` - Cache-busting headers, URL verification
3. `scripts/production/iwf-config.js` - Increase EVENT_DELAY_MS to 5000
4. `CLAUDE.md` - Add parallel import warning section
5. `.github/workflows/monthly-iwf-scraper.yml` - Add concurrency settings

---

## SUCCESS CRITERIA

✓ Lock file prevents parallel execution
✓ Second import attempt fails with clear error message
✓ Cache-busting headers included in all requests
✓ URL verification catches CDN cache misses
✓ 5-second delay between events enforced
✓ Documentation clearly warns against parallel execution
✓ GitHub Actions workflow prevents concurrent runs
✓ No new phantom records after implementation
