console.log('🔍 Daily scraper starting...');
console.log('📁 Current working directory:', process.cwd());
console.log('📋 Files in current directory:', require('fs').readdirSync('.'));

const { spawn } = require('child_process');
const path = require('path');

async function main() {
    console.log('🏋️ Daily Scraper & Import Started');
    
    try {
        // Step 1: Run scraper (creates CSV)
        await runScript('meet_scraper_2025.js');
        
        // Step 2: Import CSV to database (NEW)
        await runScript('database-importer.js');
        
        console.log('🎉 Daily pipeline completed!');
    } catch (error) {
        console.log('💥 Pipeline failed:', error.message);
        process.exit(1);
    }
}
