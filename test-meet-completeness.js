/**
 * Test script for meet completeness analysis
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { MeetCompletenessEngine } = require('./scripts/meet-re-import/lib/meet-completeness-engine');

async function testMeetCompletenessAnalysis() {
    console.log('🧪 Testing Meet Completeness Analysis...\n');

    // Initialize Supabase client
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Initialize completeness engine
    const engine = new MeetCompletenessEngine(supabase);

    try {
        // Test with a known meet ID (you can change this to a real meet ID)
        const testMeetId = 2308; // Example meet ID
        
        console.log(`📊 Analyzing completeness for meet ${testMeetId}...`);
        const result = await engine.analyzeMeetCompleteness(testMeetId);
        
        console.log('\n✅ Analysis Result:');
        console.log('  Meet ID:', result.meetId);
        console.log('  Meet Name:', result.meetName);
        console.log('  Meet Date:', result.meetDate);
        console.log('  Sport80 ID:', result.meetInternalId);
        console.log('  Sport80 Count:', result.sport80ResultCount);
        console.log('  Database Count:', result.databaseResultCount);
        console.log('  Counts Match:', result.resultCountMatch);
        console.log('  Is Complete:', result.isComplete);
        console.log('  Discrepancy:', result.discrepancy);
        console.log('  Status:', result.status);
        
        if (result.errorLog.length > 0) {
            console.log('  Errors:', result.errorLog);
        }

        // Test getting incomplete meets
        console.log('\n📋 Getting incomplete meets...');
        const incompleteMeets = await engine.getIncompleteMeets({ limit: 5 });
        
        console.log(`\n📈 Found ${incompleteMeets.length} incomplete meets (limited to 5):`);
        incompleteMeets.forEach((meet, index) => {
            console.log(`  ${index + 1}. Meet ${meet.id} (${meet.name})`);
            console.log(`     Sport80: ${meet.completenessResult.sport80ResultCount}, DB: ${meet.completenessResult.databaseResultCount}`);
            console.log(`     Discrepancy: ${meet.completenessResult.discrepancy}`);
        });

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
testMeetCompletenessAnalysis();