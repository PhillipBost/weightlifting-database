const puppeteer = require('puppeteer');
const fs = require('fs');

const JSON_FILE = 'internal_ids.json';
const CSV_FILE = 'internal_ids.csv'; // Still export CSV for compatibility
const BATCH_SIZE = 50;
const REQUEST_DELAY = 500; // ms
const MAX_CONSECUTIVE_ERRORS = 10;

// Load existing data from JSON file
function loadExistingData() {
  if (fs.existsSync(JSON_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
      console.log(`Loaded existing data: ${Object.keys(data.athletes || {}).length} athletes, ${data.failedIds?.length || 0} failed IDs`);
      return {
        athletes: data.athletes || {},
        failedIds: data.failedIds || [],
        lastProcessedId: data.lastProcessedId || 0
      };
    } catch (error) {
      console.log('Error reading JSON file, starting fresh:', error.message);
    }
  } else {
    console.log('JSON file does not exist. Starting fresh.');
  }
  
  return {
    athletes: {},
    failedIds: [],
    lastProcessedId: 0
  };
}

// Save data to JSON file
function saveDataToJSON(data) {
  try {
    fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving JSON file:', error);
    return false;
  }
}

// Export data to CSV file
function exportToCSV(athletes) {
  try {
    const csv = require('csv-writer');
    const csvWriter = csv.createObjectCsvWriter({
      path: CSV_FILE,
      header: [
        { id: 'athleteId', title: 'internal_id' },
        { id: 'athleteName', title: 'lifter' }
      ]
    });

    const records = Object.entries(athletes).map(([id, name]) => ({
      athleteId: parseInt(id),
      athleteName: name
    })).sort((a, b) => a.athleteId - b.athleteId);

    csvWriter.writeRecords(records);
    console.log(`Exported ${records.length} athletes to CSV file.`);
    return true;
  } catch (error) {
    console.error('Error exporting to CSV:', error);
    return false;
  }
}

// Function to scrape athlete data with retry logic
async function scrapeAthleteData(page, id, retryCount = 0) {
  const MAX_RETRIES = 3;
  const url = `https://usaweightlifting.sport80.com/public/rankings/member/${id}`;
  
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });
    
    // Wait for table with a shorter timeout to fail faster on missing data
    await page.waitForSelector('table', { timeout: 2000 });
    
    const athleteName = await page.$$eval('table tr', (rows) => {
      if (rows.length > 1) {
        const cols = rows[1].querySelectorAll('td');
        // Column 3 (index 3) contains the "Lifter" name
        if (cols.length > 3) {
          const lifterName = cols[3].textContent.trim();
          // Only return valid names (not empty, not just "-")
          if (lifterName && lifterName !== '-' && lifterName.length > 0) {
            return lifterName;
          }
        }
      }
      return null;
    });

    if (athleteName) {
      return athleteName;
    } else {
      return null;
    }
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} for athlete ID ${id}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return scrapeAthleteData(page, id, retryCount + 1);
    } else {
      console.log(`Failed to fetch data for athlete ID ${id} after ${MAX_RETRIES} retries.`);
      return null;
    }
  }
}

(async () => {
  let browser;
  
  try {
    // Load existing data
    let data = loadExistingData();
    
    browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    // Set a user agent to appear more like a regular browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    let totalProcessed = 0;
    let saveCounter = 0;
    
    // Phase 1: Retry previously failed IDs
    if (data.failedIds.length > 0) {
      console.log(`\n=== PHASE 1: Retrying ${data.failedIds.length} previously failed IDs ===`);
      
      const stillFailedIds = [];
      
      for (let i = 0; i < data.failedIds.length; i++) {
        const failedId = data.failedIds[i];
        console.log(`Retrying failed ID ${failedId} (${i + 1}/${data.failedIds.length})`);
        
        const athleteName = await scrapeAthleteData(page, failedId);
        
        if (athleteName) {
          data.athletes[failedId] = athleteName;
          totalProcessed++;
          console.log(`✓ Successfully retried: ${athleteName} (ID: ${failedId})`);
        } else {
          stillFailedIds.push(failedId);
          console.log(`✗ Still failed after retry: ID ${failedId}`);
        }
        
        // Save progress every 10 retries
        if ((i + 1) % 10 === 0) {
          data.failedIds = stillFailedIds.concat(data.failedIds.slice(i + 1));
          saveDataToJSON(data);
          console.log(`Progress saved after ${i + 1} retries.`);
        }
        
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      }
      
      data.failedIds = stillFailedIds;
      console.log(`Phase 1 completed. ${totalProcessed} previously failed IDs recovered.`);
    }
    
    // Phase 2: Continue sequential scraping
    console.log(`\n=== PHASE 2: Sequential scraping starting from ID ${data.lastProcessedId + 1} ===`);
    
    let id = data.lastProcessedId + 1;
    let consecutiveErrors = 0;
    
    while (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
      console.log(`Processing athlete ID: ${id}`);
      
      // Skip if we already have this athlete
      if (data.athletes[id]) {
        console.log(`↷ Skipping ID ${id} - already have: ${data.athletes[id]}`);
        id++;
        continue;
      }
      
      const athleteName = await scrapeAthleteData(page, id);
      
      if (athleteName) {
        data.athletes[id] = athleteName;
        data.lastProcessedId = id;
        consecutiveErrors = 0;
        totalProcessed++;
        console.log(`✓ Fetched: ${athleteName} (ID: ${id})`);
      } else {
        consecutiveErrors++;
        data.failedIds.push(id);
        data.lastProcessedId = id;
        console.log(`✗ No data for ID ${id} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} consecutive errors) - Added to retry list`);
      }
      
      // Save progress every BATCH_SIZE operations
      saveCounter++;
      if (saveCounter >= BATCH_SIZE) {
        const success = saveDataToJSON(data);
        if (success) {
          exportToCSV(data.athletes);
          console.log(`Progress saved. Total athletes: ${Object.keys(data.athletes).length}, Failed IDs: ${data.failedIds.length}`);
        } else {
          console.error('Failed to save progress. Stopping to prevent data loss.');
          break;
        }
        saveCounter = 0;
      }
      
      id++;
      
      if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      }
    }
    
    // Final save
    const success = saveDataToJSON(data);
    if (success) {
      exportToCSV(data.athletes);
    }
    
    console.log(`\n=== SCRAPING COMPLETED ===`);
    console.log(`Total athletes in database: ${Object.keys(data.athletes).length}`);
    console.log(`Athletes processed this session: ${totalProcessed}`);
    console.log(`Failed IDs to retry next time: ${data.failedIds.length}`);
    console.log(`Last processed ID: ${data.lastProcessedId}`);
    console.log(`Reason for stopping: ${consecutiveErrors >= MAX_CONSECUTIVE_ERRORS ? 'Too many consecutive errors' : 'Manual stop'}`);
    
    if (data.failedIds.length > 0) {
      console.log(`Failed IDs: ${data.failedIds.slice(0, 20).join(', ')}${data.failedIds.length > 20 ? '...' : ''}`);
    }
    
  } catch (error) {
    console.error('Fatal error occurred:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();