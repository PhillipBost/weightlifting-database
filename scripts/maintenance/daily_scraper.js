console.log('🔍 Daily scraper starting...');
console.log('📁 Current working directory:', process.cwd());
console.log('📋 Files in current directory:', require('fs').readdirSync('.'));

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function runScript(scriptName, args = []) {
    return new Promise((resolve, reject) => {
        console.log(`🚀 Starting ${scriptName}...`);
        if (args.length > 0) console.log(`   Args: ${args.join(' ')}`);
        console.log(`📅 ${new Date().toISOString()}`);

        const child = spawn('node', [scriptName, ...args], {
            stdio: 'inherit',
            cwd: process.cwd()
        });

        console.log(`✅ Spawn created for ${scriptName}`);

        child.on('close', (code) => {
            console.log(`📊 ${scriptName} process closed with code: ${code}`);
            if (code === 0) {
                console.log(`✅ ${scriptName} completed successfully`);
                resolve(code);
            } else {
                console.log(`❌ ${scriptName} failed with exit code: ${code}`);
                reject(new Error(`${scriptName} failed with exit code: ${code}`));
            }
        });

        child.on('error', (error) => {
            console.log(`💥 Error running ${scriptName}:`, error.message);
            reject(error);
        });
    });
}

async function delay(seconds) {
    console.log(`⏳ Waiting ${seconds} seconds...`);
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function main() {
    console.log('🏋️ Daily Scraper & Database Import Started');
    console.log('==========================================');
    console.log(`📍 Working directory: ${process.cwd()}`);
    console.log(`🕐 Start time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

    try {
        // Step 1: Run meet scraper
        // Pass any command line arguments (like --date=2025-12) to the scraper
        const args = process.argv.slice(2);
        await runScript('scripts/production/meet_scraper.js', args);

        // Step 2: Wait 10 seconds
        await delay(10);

        // Step 3: Run address scraper (New Step)
        console.log('\n📍 Step 3: Running Meet Address Scraper...');
        // Pass the same args (e.g., --date=...) to the address scraper
        await runScript('scripts/production/meet-address-scraper.js', args);

        // Step 4: Run geocoder (New Step)
        console.log('\n🌍 Step 4: Running Geocoder...');
        await runScript('scripts/geographic/geocode-and-import.js');

        // Step 5: Import to database
        await runScript('scripts/production/database-importer.js', args);

        // Step 6: Pipeline Handoff - Reimport & WSO Backfill
        const scrapedMeetsPath = 'output/scraped_meets.json';
        if (fs.existsSync(scrapedMeetsPath)) {
            console.log('\n🔄 Checking for scraped meets to post-process...');
            const meetIds = JSON.parse(fs.readFileSync(scrapedMeetsPath, 'utf8'));

            if (meetIds && meetIds.length > 0) {
                console.log(`🎯 Found ${meetIds.length} meets to post-process: ${meetIds.join(', ')}`);
                const meetIdString = meetIds.join(',');

                // Step 6a: Run Reimport (Data Quality Check)
                console.log('\n🔍 Step 6a: Running Data Quality Reimport (High Fidelity)...');
                // The user wants to FORCE this for all new meets to ensure we get the best data immediately
                // This uses the "Custom" importer under the hood which has the multi-tier verification
                await runScript('scripts/unified-scraper.js', [
                    '--mode=reimport',
                    `--meet-ids=${meetIdString}`,
                    '--force'
                ]);

                // Step 6b: Run WSO Backfill (Metadata Enrichment)
                console.log('\n🌍 Step 6b: Running WSO Metadata Backfill...');
                // Run without restrictive flags to catch anything that needs metadata
                await runScript('scripts/unified-scraper.js', [
                    '--mode=wso',
                    `--meet-ids=${meetIdString}`
                ]);

            } else {
                console.log('ℹ️ Scraped meets file exists but is empty. No post-processing needed.');
            }
        } else {
            console.log('ℹ️ No scraped_meets.json found. Skipping post-processing.');
        }

        console.log('\n🎉 Daily scraping and import completed successfully!');
        console.log(`🕐 End time: ${new Date().toLocaleString()}`);
        process.exit(0); // Exit cleanly so the process doesn't hang

    } catch (error) {
        console.log('\n💥 Daily pipeline failed:', error.message);
        console.log(`🕐 Failed at: ${new Date().toLocaleString()}`);
        process.exit(1); // Exit with error code so GitHub Actions knows it failed
    }
}

// Run the main function
main();
