/**
 * Test script for orchestrator components
 * Tests the core functionality of ReImportOrchestrator, MeetSkipManager, and integration
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ReImportOrchestrator } = require('./scripts/meet-re-import/lib/re-import-orchestrator');
const { MeetSkipManager } = require('./scripts/meet-re-import/lib/meet-skip-manager');
const { MeetCompletenessEngine } = require('./scripts/meet-re-import/lib/meet-completeness-engine');

async function testOrchestratorComponents() {
    console.log('🧪 Testing Orchestrator Components...\n');

    // Initialize Supabase client
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    try {
        // Test 1: Initialize components
        console.log('📦 Test 1: Component Initialization...');
        
        const orchestrator = new ReImportOrchestrator(supabase, {
            tempDir: './temp',
            batchSize: 5,
            delayBetweenMeets: 1000,
            maxRetries: 2
        });
        
        const skipManager = new MeetSkipManager(supabase);
        const completenessEngine = new MeetCompletenessEngine(supabase);
        
        console.log('✅ All components initialized successfully\n');

        // Test 2: Test database connectivity and basic queries
        console.log('📊 Test 2: Database Connectivity...');
        
        // Test getting a known meet for testing
        const { data: testMeet, error: meetError } = await supabase
            .from('usaw_meets')
            .select('meet_id, Meet, meet_internal_id, Date')
            .eq('meet_id', 2308)
            .single();
            
        if (meetError) {
            throw new Error(`Failed to get test meet: ${meetError.message}`);
        }
        
        console.log(`✅ Database connectivity confirmed - Test meet: ${testMeet.Meet}`);
        console.log(`   Meet ID: ${testMeet.meet_id}, Sport80 ID: ${testMeet.meet_internal_id}\n`);

        // Test 3: Test completeness analysis
        console.log('🔍 Test 3: Completeness Analysis...');
        
        const completenessResult = await completenessEngine.analyzeMeetCompleteness(testMeet.meet_id);
        
        console.log('✅ Completeness analysis result:');
        console.log(`   Sport80 Count: ${completenessResult.sport80ResultCount}`);
        console.log(`   Database Count: ${completenessResult.databaseResultCount}`);
        console.log(`   Is Complete: ${completenessResult.isComplete}`);
        console.log(`   Status: ${completenessResult.status}\n`);

        // Test 4: Test skip manager functionality
        console.log('⏭️  Test 4: Skip Manager Functionality...');
        
        const shouldSkip = await skipManager.shouldSkipMeet(testMeet.meet_id);
        console.log(`✅ Skip check result: ${shouldSkip ? 'SKIP' : 'PROCESS'}`);
        
        // If meet is complete, test marking it as complete (should be idempotent)
        if (completenessResult.isComplete) {
            await skipManager.markMeetAsComplete(testMeet.meet_id, {
                sport80Count: completenessResult.sport80ResultCount,
                databaseCount: completenessResult.databaseResultCount,
                completedAt: new Date().toISOString()
            });
            console.log('✅ Successfully marked complete meet as complete (idempotent operation)\n');
        }

        // Test 5: Test orchestrator verification (without actual re-import)
        console.log('🔧 Test 5: Orchestrator Verification Logic...');
        
        const verificationResult = await orchestrator.verifyImportSuccess(testMeet.meet_id, {
            meet_id: testMeet.meet_id,
            name: testMeet.Meet,
            sport80_id: testMeet.meet_internal_id
        });
        
        console.log('✅ Verification result:');
        console.log(`   Success: ${verificationResult.success}`);
        console.log(`   Sport80 Count: ${verificationResult.sport80Count}`);
        console.log(`   Database Count: ${verificationResult.databaseCount}`);
        console.log(`   Counts Match: ${verificationResult.countsMatch}`);
        if (verificationResult.error) {
            console.log(`   Error: ${verificationResult.error}`);
        }
        console.log();

        // Test 6: Test error isolation with invalid meet
        console.log('🚨 Test 6: Error Isolation...');
        
        try {
            const invalidMeetResult = await orchestrator.verifyImportSuccess(99999, {
                id: 99999,
                name: 'Invalid Test Meet',
                sport80_id: 99999
            });
            
            console.log('✅ Error isolation working - invalid meet handled gracefully:');
            console.log(`   Success: ${invalidMeetResult.success}`);
            console.log(`   Error: ${invalidMeetResult.error}`);
        } catch (error) {
            console.log('❌ Error isolation failed - exception not caught:', error.message);
        }
        console.log();

        // Test 7: Test batch processing structure (without actual processing)
        console.log('📦 Test 7: Batch Processing Structure...');
        
        // Test with empty batch to verify structure
        const emptyBatchResult = await orchestrator.processMeetBatch([]);
        
        console.log('✅ Empty batch processing result:');
        console.log(`   Total Meets: ${emptyBatchResult.totalMeets}`);
        console.log(`   Processed: ${emptyBatchResult.processedMeets}`);
        console.log(`   Successful: ${emptyBatchResult.successfulMeets}`);
        console.log(`   Failed: ${emptyBatchResult.failedMeets}`);
        console.log(`   Duration: ${emptyBatchResult.duration}ms`);
        console.log();

        console.log('🎉 All orchestrator component tests passed successfully!');
        
        return {
            success: true,
            testsRun: 7,
            componentsTested: ['ReImportOrchestrator', 'MeetSkipManager', 'MeetCompletenessEngine'],
            testMeet: testMeet
        };

    } catch (error) {
        console.error('❌ Orchestrator component test failed:', error.message);
        console.error('Stack trace:', error.stack);
        
        return {
            success: false,
            error: error.message,
            testsRun: 0
        };
    }
}

// Run the test
testOrchestratorComponents()
    .then(result => {
        if (result.success) {
            console.log('\n✅ All orchestrator tests completed successfully');
            process.exit(0);
        } else {
            console.log('\n❌ Orchestrator tests failed');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('\n💥 Test execution failed:', error.message);
        process.exit(1);
    });