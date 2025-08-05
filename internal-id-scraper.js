const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-writer');
const csvParser = require('csv-parser');

const CSV_FILE = 'internal_ids.csv';
const BATCH_SIZE = 50;
const REQUEST_DELAY = 500; // ms
const MAX_CONSECUTIVE_ERRORS = 10;

const csvWriter = csv.createObjectCsvWriter({
  path: CSV_FILE,
  header: [
    { id: 'athleteId', title: 'Athlete ID' },
    { id: 'athleteName', title: 'Athlete Name' }
  ],
  append: true
});

// Function to get the highest athlete ID from existing CSV file
async function getLastAthleteId() {
  return new Promise((resolve) => {
    if (!fs.existsSync(CSV_FILE)) {
      console.log('CSV file does not exist. Starting from ID 1.');
      resolve(0);
      return;
    }

    let maxId = 0;
    fs.createReadStream(CSV_FILE)
      .pipe(csvParser())
      .on('data', (row) => {
        const id = parseInt(row['Athlete ID']);
        if (!isNaN(id) && id > maxId) {
          maxId = id;
        }
      })
      .on('end', () => {
        console.log(`Found existing data. Resuming from ID ${maxId + 1}.`);
        resolve(maxId);
      })
      .on('error', (error) => {
        console.log('Error reading existing CSV file. Starting from ID 1.');
        console.error(error);
        resolve(0);
      });
  });
}

// Function to write records to CSV with error handling
async function writeRecordsToCSV(records) {
  try {
    await csvWriter.writeRecords(records);
    console.log(`Successfully wrote ${records.length} records to CSV.`);
    return true;
  } catch (error) {
    console.error('Error writing to CSV:', error);
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
    
    // Debug: Let's see what the table structure actually looks like
    const tableData = await page.$eval('table tr', (rows) => {
      const result = {
        rowCount: rows.length,
        headers: [],
        firstDataRow: [],
        allData: []
      };
      
      // Get headers if they exist
      if (rows.length > 0) {
        const headerCells = rows[0].querySelectorAll('th, td');
        result.headers = Array.from(headerCells).map(cell => cell.textContent.trim());
      }
      
      // Get first data row
      if (rows.length > 1) {
        const dataCells = rows[1].querySelectorAll('td');
        result.firstDataRow = Array.from(dataCells).map(cell => cell.textContent.trim());
      }
      
      // Get all data for debugging (limit to first 3 rows to avoid spam)
      for (let i = 0; i < Math.min(rows.length, 3); i++) {
        const cells = rows[i].querySelectorAll('th, td');
        result.allData.push(Array.from(cells).map(cell => cell.textContent.trim()));
      }
      
      return result;
    });

    // Log the table structure for debugging
    console.log(`\n--- Table Structure for ID ${id} ---`);
    console.log('Row count:', tableData.rowCount);
    console.log('Headers:', tableData.headers);
    console.log('First data row:', tableData.firstDataRow);
    console.log('All data (first 3 rows):', tableData.allData);
    console.log('--- End Debug Info ---\n');

    // Try to find athlete name - let's check multiple possible positions
    let athleteName = null;
    
    if (tableData.firstDataRow.length > 0) {
      // Look for what might be an athlete name (non-empty, not just "-", not a weight class)
      for (let i = 0; i < tableData.firstDataRow.length; i++) {
        const cellValue = tableData.firstDataRow[i];
        if (cellValue && 
            cellValue !== '-' && 
            !cellValue.includes('kg') && 
            !cellValue.includes('Kg') &&
            !cellValue.match(/^\d+$/) && // not just a number
            cellValue.length > 2) {
          athleteName = cellValue;
          console.log(`Found potential athlete name in column ${i}: "${athleteName}"`);
          break;
        }
      }
    }

    if (athleteName && athleteName.length > 0) {
      return { athleteId: id, athleteName: athleteName };
    } else {
      return null; // No valid athlete name found
    }
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} for athlete ID ${id}`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait longer before retry
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
    // Get the starting ID from existing CSV file
    const lastId = await getLastAthleteId();
    let id = lastId + 1;
    
    browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Set a user agent to appear more like a regular browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    let records = [];
    let consecutiveErrors = 0;
    let totalProcessed = 0;
    
    console.log(`Starting scrape from athlete ID: ${id}`);
    
    while (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
      console.log(`Processing athlete ID: ${id}`);
      
      const athleteData = await scrapeAthleteData(page, id);
      
      if (athleteData) {
        records.push(athleteData);
        consecutiveErrors = 0; // Reset error counter on successful fetch
        console.log(`✓ Fetched: ${athleteData.athleteName} (ID: ${id})`);
      } else {
        consecutiveErrors++;
        console.log(`✗ No data for ID ${id} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} consecutive errors)`);
      }
      
      // Write to CSV every BATCH_SIZE records or if we're approaching the error limit
      if (records.length >= BATCH_SIZE || (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS - 1 && records.length > 0)) {
        const success = await writeRecordsToCSV(records);
        if (success) {
          totalProcessed += records.length;
          records = []; // Clear the batch
        } else {
          console.error('Failed to write records. Stopping to prevent data loss.');
          break;
        }
      }
      
      id++;
      
      // Add delay between requests to be respectful to the server
      if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      }
    }
    
    // Write any remaining records
    if (records.length > 0) {
      const success = await writeRecordsToCSV(records);
      if (success) {
        totalProcessed += records.length;
      }
    }
    
    console.log(`\nScraping completed!`);
    console.log(`Total athletes processed: ${totalProcessed}`);
    console.log(`Stopped at athlete ID: ${id - 1}`);
    console.log(`Reason: ${consecutiveErrors >= MAX_CONSECUTIVE_ERRORS ? 'Too many consecutive errors' : 'Manual stop'}`);
    
  } catch (error) {
    console.error('Fatal error occurred:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();