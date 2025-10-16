console.log('🔍 Daily scraper starting...');
console.log('📁 Current working directory:', process.cwd());
console.log('📋 Files in current directory:', require('fs').readdirSync('.'));

const { spawn } = require('child_process');
const path = require('path');

async function runScript(scriptName) {
    return new Promise((resolve, reject) => {
        console.log(`🚀 Starting ${scriptName}...`);
        console.log(`📅 ${new Date().toISOString()}`);
        console.log(`🔍 About to spawn: node ${scriptName}`);
        
        const child = spawn('node', [scriptName], {
            stdio: 'inherit', // This will show the script output in real-time
            cwd: process.cwd()
        });
        
        console.log(`✅ Spawn created for ${scriptName}`);
        
        child.on('close', (code) => {
            console.log(`📊 ${scriptName} process closed with code: ${code}`);
            if (code === 0) {
                console.log(`✅ ${scriptName} completed successfully (exit code: ${code})`);
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
        await runScript('scripts/production/meet_scraper_2025.js');
        
        // Step 2: Wait 10 seconds
        await delay(10);
        
        // Step 3: Import to database
        await runScript('scripts/production/database-importer.js');
        
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
