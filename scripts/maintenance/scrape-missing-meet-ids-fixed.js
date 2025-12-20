require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { scrapeOneMeet } = require('../production/scrapeOneMeet.js');
const { 
    getExistingMeetIds, 
    upsertMeetsToDatabase, 
    processMeetCsvFile,
    extractMeetInternalId
} = require('../production/database-importer-custom.js');

/**
 * Scrape Missing Meet ID Gaps
 * 
 * This script identifies gaps in the sequential meet_internal_id sequence
 * and scrapes the missing meets from Sport80.
 */

async function findGaps(existingIds) {
    if (existingIds.size === 0) return [];
    
    const ids = Array.from(existingIds).sort((a, b) => a - b);
    const min = ids[0];
    const max = ids[ids.length - 1];
    const gaps = [];
    
    console.log(`🔍 Checking gaps between ID ${min} and ${max}...`);
    
    for (let i = min; i <= max; i++) {
        if (!existingIds.has(i)) {
            gaps.push(i);
        }
    }
    
    return gaps;
}

async function getMeetMetadataFromCsv(filePath, internalId) {
    const csvContent = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(csvContent, {
        header: true,
        delimiter: '|',
        skipEmptyLines: true
    });
    
    if (parsed.data && parsed.data.length > 0) {
        const firstRow = parsed.data[0];
        return {
            meet_id: internalId, // Using internal_id as meet_id for consistency
            Meet: firstRow.Meet || `Meet ${internalId}`,
            Date: firstRow.Date || null,
            URL: `https://usaweightlifting.sport80.com/public/rankings/results/${internalId}`,
            Level: firstRow.Level || 'Unknown',
            Results: parsed.data.length,
            batch_id: 'gap-recovery-' + new Date().toISOString().split('T')[0],
            scraped_date: new Date().toISOString()
        };
    }
    return null;
}

async function main() {
    const DRY_RUN = process.env.DRY_RUN === 'true';
    const MAX_GAPS = parseInt(process.env.MAX_GAPS) || 5;
    const START_ID = parseInt(process.env.START_ID) || null;
    const END_ID = parseInt(process.env.END_ID) || null;

    console.log('🚀 Starting Gap Recovery Script');
    console.log(`⚙️ Settings: DRY_RUN=${DRY_RUN}, MAX_GAPS=${MAX_GAPS}`);

    try {
        const { internalIds } = await getExistingMeetIds();
        let gaps = await findGaps(internalIds);

        if (START_ID || END_ID) {
            gaps = gaps.filter(id => {
                if (START_ID && id < START_ID) return false;
                if (END_ID && id > END_ID) return false;
                return true;
            });
            console.log(`🎯 Filtered to ${gaps.length} gaps within range ${START_ID || 'min'} to ${END_ID || 'max'}`);
        }

        console.log(`📊 Found ${gaps.length} total gaps in database.`);
        
        const toProcess = gaps.slice(0, MAX_GAPS);
        console.log(`⏭️ Processing first ${toProcess.length} gaps: ${toProcess.join(', ')}`);

        if (DRY_RUN) {
            console.log('⚠️ DRY RUN: No data will be scraped or imported.');
            return;
        }

        for (const gapId of toProcess) {
            const tempFile = path.join(__dirname, `../../temp_gap_${gapId}.csv`);
            console.log(`\n🛠️ Processing Gap ID: ${gapId}`);
            
            try {
                console.log(`🌐 Scraping meet ${gapId}...`);
                await scrapeOneMeet(gapId, tempFile);

                if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size < 100) {
                    console.log(`⚠️ No data found for meet ${gapId}. It might be empty or invalid.`);
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    continue;
                }

                console.log(`📄 Extracting metadata...`);
                const meetMetadata = await getMeetMetadataFromCsv(tempFile, gapId);
                
                if (meetMetadata) {
                    console.log(`📥 Importing meet metadata: ${meetMetadata.Meet}`);
                    await upsertMeetsToDatabase([meetMetadata]);

                    console.log(`📥 Importing results...`);
                    await processMeetCsvFile(tempFile, gapId, meetMetadata.Meet);
                    console.log(`✅ Successfully recovered meet ${gapId}`);
                }

            } catch (error) {
                console.error(`❌ Failed to process gap ${gapId}:`, error.message);
            } finally {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                    console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                }
            }

            // Respectful delay
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('\n🏁 Gap recovery process completed.');

    } catch (error) {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    }
}

main();
