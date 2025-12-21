const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkMeet2357Details() {
    console.log('🔍 Checking meet 2357 details...');
    
    try {
        // Get meet details
        const { data: meetData, error: meetError } = await supabase
            .from('usaw_meets')
            .select('meet_id, meet_internal_id, Meet, Date, URL, Level')
            .eq('meet_id', 2357)
            .single();
        
        if (meetError) {
            console.log('❌ Error fetching meet:', meetError.message);
            return;
        }
        
        console.log('📋 Meet 2357 Details:');
        console.log('   Meet ID:', meetData.meet_id);
        console.log('   Internal ID:', meetData.meet_internal_id);
        console.log('   Name:', meetData.Meet);
        console.log('   Date:', meetData.Date);
        console.log('   URL:', meetData.URL);
        console.log('   Level:', meetData.Level);
        
        // Get some results from this meet
        const { data: results, error: resultsError } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id, lifter_name, date')
            .eq('meet_id', 2357)
            .limit(5);
        
        console.log('\\n📊 Sample results from meet 2357:');
        results?.forEach(result => {
            console.log(`   ${result.lifter_name} (ID: ${result.lifter_id}) - ${result.date}`);
        });
        
        // Check if the meet_internal_id matches what we expect
        if (meetData.URL) {
            const urlMatch = meetData.URL.match(/\/results\/(\d+)/);
            const urlInternalId = urlMatch ? parseInt(urlMatch[1]) : null;
            
            console.log('\\n🔍 URL Analysis:');
            console.log('   URL Internal ID:', urlInternalId);
            console.log('   Database Internal ID:', meetData.meet_internal_id);
            console.log('   Match:', urlInternalId === meetData.meet_internal_id ? '✅' : '❌');
        }
        
        // The key insight: Tier 2 verification looks for meet_internal_id (not meet_id) in Sport80 history
        console.log('\\n🎯 KEY INSIGHT:');
        console.log(`   Tier 2 verification should look for internal_id ${meetData.meet_internal_id} in Sport80 history`);
        console.log(`   NOT meet_id ${meetData.meet_id}`);
        
    } catch (error) {
        console.error('💥 Check failed:', error.message);
    }
}

checkMeet2357Details();