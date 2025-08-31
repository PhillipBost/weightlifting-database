const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function importBrianLe() {
    console.log('🎯 Importing Brian Le from meet 7011...');
    
    // Read the CSV file
    const csvContent = fs.readFileSync('./meet_7011_rescrape.csv', 'utf8');
    const lines = csvContent.split('\n');
    const headers = lines[0].split('|');
    
    // Find Brian Le's row
    const brianRow = lines.find(line => line.includes('Brian Le'));
    if (!brianRow) {
        console.log('❌ Brian Le not found in CSV');
        return;
    }
    
    const brianData = brianRow.split('|');
    console.log('📋 Brian Le data:', brianData.slice(0, 6)); // Show first 6 columns
    
    // Check if this result already exists
    const { data: existingResult } = await supabase
        .from('meet_results')
        .select('result_id')
        .eq('lifter_name', 'Brian Le')
        .eq('meet_name', 'The HEAVY Athletics Open')
        .eq('date', '2025-08-22');
    
    if (existingResult && existingResult.length > 0) {
        console.log('✅ Brian Le result already exists for this meet');
        return;
    }
    
    // Get meet_id for this meet
    const { data: meetData } = await supabase
        .from('meets')
        .select('meet_id')
        .eq('meet_internal_id', 7011)
        .single();
    
    if (!meetData) {
        console.log('❌ Meet 7011 not found');
        return;
    }
    
    // Parse the data
    const snatch1 = brianData[6].startsWith('-') ? -parseInt(brianData[6].slice(1)) : parseInt(brianData[6]);
    const snatch2 = parseInt(brianData[7]) || null;
    const snatch3 = parseInt(brianData[8]) || null;
    const cj1 = parseInt(brianData[9]) || null;
    const cj2 = parseInt(brianData[10]) || null;
    const cj3 = parseInt(brianData[11]) || null;
    
    // Insert Brian Le's result
    const result = {
        meet_id: meetData.meet_id,
        lifter_id: 48108, // Carolina Brian Le
        meet_name: 'The HEAVY Athletics Open',
        date: '2025-08-22',
        age_category: 'Open Men\'s',
        weight_class: '88kg',
        lifter_name: 'Brian Le',
        body_weight_kg: parseFloat(brianData[5]) || null,
        snatch_lift_1: snatch1,
        snatch_lift_2: snatch2,
        snatch_lift_3: snatch3,
        cj_lift_1: cj1,
        cj_lift_2: cj2,
        cj_lift_3: cj3,
        best_snatch: parseInt(brianData[12]) || null,
        best_cj: parseInt(brianData[13]) || null,
        total: parseInt(brianData[14]) || null,
        wso: 'Carolina',
        club_name: null,
        created_at: new Date().toISOString()
    };
    
    console.log(`📊 Inserting: ${result.lifter_name} - Total: ${result.total}kg`);
    
    const { data: insertedData, error: insertError } = await supabase
        .from('meet_results')
        .insert(result)
        .select('result_id');
    
    if (insertError) {
        console.error('❌ Insert error:', insertError.message);
        return;
    }
    
    // Update with gender info after insert (workaround for constraint issue)
    if (insertedData && insertedData[0]) {
        const { error: updateError } = await supabase
            .from('meet_results')
            .update({ gender: 'M' })
            .eq('result_id', insertedData[0].result_id);
            
        if (updateError) {
            console.log('⚠️  Could not update gender:', updateError.message);
        } else {
            console.log('✅ Updated gender field');
        }
    }
    
    console.log('✅ Successfully added Brian Le\'s result to meet 7011');
    console.log(`   Total: ${result.total}kg, assigned to lifter_id: ${result.lifter_id}`);
}

importBrianLe().catch(console.error);