const { createClient } = require('@supabase/supabase-js');
const { scrapeOneMeet } = require('../production/scrapeOneMeet');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

async function main() {
    try {
        const MEET_ID = 2405;
        const SPORT80_ID = 2405;
        const TEMP_CSV = path.join(__dirname, 'temp_meet_2405.csv');

        console.log(`🔍 Starting comparison for Meet ${MEET_ID} (Sport80: ${SPORT80_ID})`);

        // 1. Fetch DB Results
        console.log('Fetching database results...');
        const { data: dbResults, error } = await supabase
            .from('usaw_meet_results')
            .select('*')
            .eq('meet_id', MEET_ID);

        if (error) {
            console.error('DB Error:', error);
            return;
        }
        if (!dbResults) {
            console.error('DB Results is null/undefined');
            return;
        }
        console.log(`✅ Found ${dbResults.length} results in database.`);

        // 2. Scrape Sport80
        console.log('Scraping Sport80...');
        if (fs.existsSync(TEMP_CSV)) fs.unlinkSync(TEMP_CSV);

        try {
            await scrapeOneMeet(SPORT80_ID, TEMP_CSV);
        } catch (e) {
            console.error('Scrape failed:', e);
            // Don't return if file exists from previous run maybe? No, let's stop.
            return;
        }

        if (!fs.existsSync(TEMP_CSV)) {
            console.error('CSV file was not created.');
            return;
        }

        // 3. Parse CSV
        const csvContent = fs.readFileSync(TEMP_CSV, 'utf8');
        console.log(`CSV Content Length: ${csvContent.length}`);

        const parsed = Papa.parse(csvContent, {
            header: true,
            delimiter: '|',
            skipEmptyLines: true
        });

        if (parsed.errors && parsed.errors.length > 0) {
            console.warn('CSV Parse Errors:', parsed.errors);
        }

        console.log('Fields:', parsed.meta.fields);

        // Filter valid rows similar to detailed-orchestrator
        const scrapedResults = parsed.data.filter((row, idx) => {
            if (!row) return false;
            if (!row.Name && !row['Name']) {
                // Only warn if it's not empty/irrelevant
                if (Object.keys(row).length > 1) console.warn(`Row ${idx} missing Name:`, row);
                return false;
            }
            const name = row.Name || row['Name'];
            return name && name.trim() !== '' && name !== 'Name';
        }).map(row => {
            // Normalize header access just in case
            return {
                ...row,
                Name: row.Name || row['Name'],
                Total: row.Total || row['Total'],
                BodyWeight: row['Body Weight (Kg)'] || row['Body Weight'] || row['body_weight']
            };
        });

        console.log(`✅ Found ${scrapedResults.length} results in scraped CSV.`);

        // 4. Compare
        console.log('\n📊 COMPARISON ANALYSIS');
        console.log('======================');

        const createKey = (name, total) => {
            try {
                const normName = name ? name.trim().toLowerCase() : 'unknown';
                const normTotal = total ? String(total).trim() : '0';
                return `${normName}|${normTotal}`;
            } catch (e) {
                console.error(`Error creating key for name: ${name}, total: ${total}`, e);
                return 'error|error';
            }
        };

        const dbMap = new Map();
        dbResults.forEach((r, idx) => {
            try {
                const key = createKey(r.athlete_name, r.total);
                if (!dbMap.has(key)) dbMap.set(key, []);
                dbMap.get(key).push(r);
            } catch (e) {
                console.error(`Error processing DB row ${idx}:`, r, e);
            }
        });

        const scrapedMap = new Map();
        scrapedResults.forEach((r, idx) => {
            try {
                const key = createKey(r.Name, r.Total);
                if (!scrapedMap.has(key)) scrapedMap.set(key, []);
                scrapedMap.get(key).push(r);
            } catch (e) {
                console.error(`Error processing Scraped row ${idx}:`, r, e);
            }
        });

        // Find Extra in DB
        const extraInDb = [];
        dbResults.forEach(r => {
            const key = createKey(r.athlete_name, r.total);
            if (!scrapedMap.has(key)) {
                extraInDb.push(r);
            } else {
                // Check duplicate counts
                const dbCount = dbMap.get(key).length;
                const scrapedCount = scrapedMap.get(key).length;
                if (dbCount > scrapedCount) {
                    const alreadyFlagged = extraInDb.some(e => createKey(e.athlete_name, e.total) === key);
                    if (!alreadyFlagged) {
                        extraInDb.push({ ...r, _reason: `Count mismatch (DB: ${dbCount}, Scraped: ${scrapedCount})` });
                    }
                }
            }
        });

        if (extraInDb.length > 0) {
            console.log(`❌ Found ${extraInDb.length} records in DB that are NOT in Scrape (or are duplicates):`);
            extraInDb.forEach(r => {
                console.log(`   - Name: ${r.athlete_name}, Total: ${r.total}, BodyWeight: ${r.body_weight}, Date: ${r.date}`);
                if (r._reason) console.log(`     Reason: ${r._reason}`);
                console.log(`     Internal ID: ${r.result_id}  (Meet: ${r.meet_id})`);
            });
        } else {
            console.log('✅ No obvious extra records found by exact Name+Total match.');
            console.log('   Checking strictly by Name Only...');

            // Name Only Check
            const dbNames = dbResults.map(r => r.athlete_name.trim().toLowerCase());
            const scrapedNames = scrapedResults.map(r => r.Name.trim().toLowerCase());

            const extraNames = dbNames.filter(n => !scrapedNames.includes(n));
            if (extraNames.length > 0) {
                console.log('   Found names in DB not in Scrape:', extraNames);
            } else {
                // Check counts by name
                const nameCountsDB = {};
                dbNames.forEach(n => nameCountsDB[n] = (nameCountsDB[n] || 0) + 1);

                const nameCountsScraped = {};
                scrapedNames.forEach(n => nameCountsScraped[n] = (nameCountsScraped[n] || 0) + 1);

                for (const name in nameCountsDB) {
                    if (nameCountsDB[name] > (nameCountsScraped[name] || 0)) {
                        console.log(`   Count mismatch for "${name}": DB has ${nameCountsDB[name]}, Scraped has ${nameCountsScraped[name] || 0}`);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Fatal error in main:', err);
    }
}

main();
