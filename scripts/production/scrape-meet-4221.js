// Scrape meet 4221: 2019 Southern Pacific LWC Championship
// This meet is missing from the database and contains a result for Annjeanine Saetern

const { scrapeOneMeet } = require('./scrapeOneMeet');
const { createClient } = require('@supabase/supabase-js');
const Papa = require('papaparse');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function scrapeMeet4221() {
    const meetId = 4221;
    const outputPath = path.join(__dirname, '../../output/meet_4221_2019_southern_pacific.csv');
    
    console.log('🏋️ Scraping Meet 4221: 2019 Southern Pacific LWC Championship');
    console.log(`   Meet ID: ${meetId}`);
    console.log(`   Output: ${outputPath}\n`);
    
    try {
        // Step 1: Scrape the meet
        console.log('📡 Starting meet scraper...');
        await scrapeOneMeet(meetId, outputPath);
        console.log('\n✅ Meet scraping complete!');
        console.log(`   Data saved to: ${outputPath}\n`);
        
        // Step 2: Check if this meet already exists in database
        console.log('🔍 Checking if meet exists in database...');
        const { data: existingMeet, error: checkError } = await supabase
            .from('usaw_meets')
            .select('meet_id')
            .eq('meet_internal_id', meetId)
            .single();
        
        if (existingMeet) {
            console.log(`   ⚠️  Meet already exists with meet_id: ${existingMeet.meet_id}`);
            console.log('   Skipping meet import, proceeding to results import\n');
        } else {
            console.log('   ✅ Meet not found - will import meet first\n');
            
            // Step 3: Insert meet record
            const meetRecord = {
                meet_internal_id: meetId,
                Meet: '2019 Southern Pacific LWC Championship',
                Date: '2019-11-02',
                Level: 'Local',
                Results: 1, // 1 = Available
                URL: `https://usaweightlifting.sport80.com/public/rankings/results/${meetId}`,
                batch_id: 'manual_import',
                scraped_date: new Date().toISOString()
            };
            
            console.log('💾 Inserting meet record into database...');
            const { data: insertedMeet, error: insertError } = await supabase
                .from('usaw_meets')
                .insert(meetRecord)
                .select('meet_id')
                .single();
            
            if (insertError) {
                throw new Error(`Failed to insert meet: ${insertError.message}`);
            }
            
            console.log(`   ✅ Meet inserted with meet_id: ${insertedMeet.meet_id}\n`);
        }
        
        console.log('📝 Next steps:');
        console.log('   1. Review the CSV to verify Annjeanine Saetern\'s result was captured');
        console.log('   2. Run database-importer to import results (or use custom import)');
        console.log('   3. Proceed with athlete merge migration');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        throw error;
    }
}

scrapeMeet4221().catch(console.error);
