/**
 * IMPORT CSV MEET SCRIPT
 * 
 * Usage: node import-csv-meet.js <csvFile>
 * Example: node import-csv-meet.js meet_6948_rescrape.csv
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const Papa = require('papaparse');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function findOrCreateLifter(lifterName) {
    const cleanName = lifterName?.toString().trim();
    if (!cleanName) {
        throw new Error('Lifter name is required');
    }

    // First try to find existing lifter by name - handle duplicates by taking the first one
    const { data: existing, error: findError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name')
        .eq('athlete_name', cleanName)
        .limit(1);

    if (findError) {
        throw new Error(`Error finding lifter: ${findError.message}`);
    }

    if (existing && existing.length > 0) {
        // If multiple lifters exist with same name, use the first one
        return existing[0];
    }

    // Create new lifter
    const { data: newLifter, error: createError } = await supabase
        .from('usaw_lifters')
        .insert([{
            athlete_name: cleanName
        }])
        .select('lifter_id, athlete_name')
        .single();

    if (createError) {
        throw new Error(`Error creating lifter: ${createError.message}`);
    }

    console.log(`✅ Created new lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
    return newLifter;
}

async function importCSVMeet() {
    const csvFile = process.argv[2];

    if (!csvFile) {
        console.log('❌ Error: Please provide a CSV file');
        console.log('Usage: node import-csv-meet.js <csvFile>');
        console.log('Example: node import-csv-meet.js meet_6948_rescrape.csv');
        process.exit(1);
    }

    if (!fs.existsSync(csvFile)) {
        console.log(`❌ Error: CSV file not found: ${csvFile}`);
        process.exit(1);
    }

    console.log(`📖 Reading CSV file: ${csvFile}`);

    // Read and parse CSV
    const csvContent = fs.readFileSync(csvFile, 'utf8');
    const parsed = Papa.parse(csvContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        delimiter: '|'  // scrapeOneMeet.js uses | delimiter
    });

    if (parsed.errors.length > 0) {
        console.log('⚠️ CSV parsing warnings:', parsed.errors);
    }

    const results = parsed.data;
    console.log(`📊 Found ${results.length} results in CSV`);

    // Extract meet ID from filename (e.g., meet_6948_rescrape.csv -> 6948)
    const meetIdMatch = csvFile.match(/meet_(\d+)/);
    if (!meetIdMatch) {
        console.log('❌ Error: Cannot extract meet ID from filename');
        process.exit(1);
    }
    const meetId = parseInt(meetIdMatch[1]);
    console.log(`🎯 Target meet ID: ${meetId}`);

    // Check if meet exists
    const { data: meetData, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet')
        .eq('meet_id', meetId)
        .single();

    if (meetError) {
        console.log(`❌ Error: Meet ${meetId} not found in database`);
        process.exit(1);
    }

    console.log(`📋 Meet: ${meetData.Meet}`);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    console.log('🔄 Processing results...');

    for (let i = 0; i < results.length; i++) {
        const result = results[i];

        if (!result.Lifter || !result.Lifter.trim()) {
            console.log(`⚠️  Skipping row ${i + 1}: No athlete name`);
            skipped++;
            continue;
        }

        try {
            // Find or create lifter
            const lifter = await findOrCreateLifter(result.Lifter);

            // Use the separate Age Category and Weight Class columns
            const ageCategory = result['Age Category'] || null;
            const weightClass = result['Weight Class'] || null;

            // Prepare meet result data
            const meetResultData = {
                meet_id: meetId,
                lifter_id: lifter.lifter_id,
                meet_name: meetData.Meet,
                date: result.Date || null,
                age_category: ageCategory,
                weight_class: weightClass,
                lifter_name: result.Lifter,
                body_weight_kg: result['Body Weight (Kg)'] || null,
                snatch_lift_1: result['Snatch Lift 1'] || null,
                snatch_lift_2: result['Snatch Lift 2'] || null,
                snatch_lift_3: result['Snatch Lift 3'] || null,
                best_snatch: result['Best Snatch'] || null,
                cj_lift_1: result['C&J Lift 1'] || null,
                cj_lift_2: result['C&J Lift 2'] || null,
                cj_lift_3: result['C&J Lift 3'] || null,
                best_cj: result['Best C&J'] || null,
                total: result.Total || null
            };

            // Insert meet result
            const { error: insertError } = await supabase
                .from('usaw_meet_results')
                .insert([meetResultData]);

            if (insertError) {
                console.log(`❌ Error inserting result for ${result.Lifter}:`, insertError.message);
                errors++;
            } else {
                imported++;
                if (imported % 50 === 0) {
                    console.log(`   Progress: ${imported}/${results.length} results imported...`);
                }
            }

        } catch (error) {
            console.log(`❌ Error processing ${result.Lifter}:`, error.message);
            errors++;
        }
    }

    console.log('\n📊 IMPORT COMPLETE');
    console.log('=================');
    console.log(`✅ Successfully imported: ${imported} results`);
    console.log(`⚠️  Skipped: ${skipped} results`);
    console.log(`❌ Errors: ${errors} results`);
    console.log(`📋 Total processed: ${results.length} results`);

    if (imported > 0) {
        console.log(`\n🎉 Meet ${meetId} now has additional results in the database!`);
    }
}

importCSVMeet().catch(console.error);