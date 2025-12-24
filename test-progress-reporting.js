/**
 * Test script for progress reporting and logging functionality
 * Tests ProgressReporter and ReImportLogger components
 */

const { ProgressReporter } = require('./scripts/meet-re-import/lib/progress-reporter');
const { ReImportLogger } = require('./scripts/meet-re-import/lib/re-import-logger');

async function testProgressReporting() {
    console.log('🧪 Testing Progress Reporting and Logging...\n');

    try {
        // Test 1: Initialize ProgressReporter
        console.log('📊 Test 1: ProgressReporter Initialization...');
        
        const progressReporter = new ProgressReporter({
            reportInterval: 3 // Report every 3 meets for testing
        });
        
        console.log('✅ ProgressReporter initialized successfully');
        console.log(`   Session ID: ${progressReporter.sessionId}`);
        console.log(`   Report Interval: ${progressReporter.options.reportInterval}`);
        console.log();

        // Test 2: Test ReImportLogger functionality
        console.log('📝 Test 2: ReImportLogger Functionality...');
        
        const logger = new ReImportLogger('TestComponent', {
            logLevel: 'debug',
            colorOutput: true
        });
        
        // Test different log levels
        logger.info('Testing info level logging', { testData: 'info test' });
        logger.warn('Testing warning level logging', { testData: 'warning test' });
        logger.debug('Testing debug level logging', { testData: 'debug test' });
        
        // Test specialized logging methods
        logger.logLifterProcessing('John Doe', 'tier2_verification', { 
            meetId: 2308, 
            searchCriteria: { name: 'John Doe', birthYear: 1990 }
        });
        
        logger.logBase64URL('https://sport80.com/rankings?division=abc123&year=2024', {
            division: 'abc123',
            year: 2024
        });
        
        logger.logTier2Verification(2, 5, { name: 'Jane Smith', club: 'Test Club' });
        
        logger.logLinkageUpdate(12345, 67890, 'Duplicate resolution', {
            evidence: 'Membership number match',
            confidence: 0.95
        });
        
        console.log('✅ ReImportLogger functionality tested\n');

        // Test 3: Track meet progress
        console.log('📈 Test 3: Meet Progress Tracking...');
        
        // Simulate processing several meets
        const testMeets = [
            { id: 2308, status: 'completed', resultsAdded: 45 },
            { id: 2309, status: 'skipped', reason: 'Already complete' },
            { id: 2310, status: 'failed', error: 'Network timeout' },
            { id: 2311, status: 'completed', resultsAdded: 32 },
            { id: 2312, status: 'completed', resultsAdded: 28 }
        ];
        
        for (const meet of testMeets) {
            await progressReporter.logMeetProgress(meet.id, meet.status, {
                resultsAdded: meet.resultsAdded,
                error: meet.error,
                reason: meet.reason
            });
            
            // Small delay to simulate processing time
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('✅ Meet progress tracking completed\n');

        // Test 4: Generate summary report
        console.log('📋 Test 4: Summary Report Generation...');
        
        const summaryReport = await progressReporter.generateSummaryReport();
        
        console.log('✅ Summary Report Generated:');
        console.log(`   Session ID: ${summaryReport.sessionId}`);
        console.log(`   Duration: ${summaryReport.durationMinutes} minutes`);
        console.log(`   Meets Processed: ${summaryReport.meetsProcessed}`);
        console.log(`   Meets Completed: ${summaryReport.meetsCompleted}`);
        console.log(`   Meets Skipped: ${summaryReport.meetsSkipped}`);
        console.log(`   Meets Failed: ${summaryReport.meetsFailed}`);
        console.log(`   Total Results Added: ${summaryReport.totalResultsAdded}`);
        console.log(`   Success Rate: ${summaryReport.successRate}`);
        console.log(`   Avg Results Per Meet: ${summaryReport.avgResultsPerMeet}`);
        console.log(`   Processing Errors: ${summaryReport.processingErrors.length}`);
        console.log();

        // Test 5: Completion statistics tracking
        console.log('📊 Test 5: Completion Statistics Tracking...');
        
        const completionStats = await progressReporter.trackCompletionStats();
        
        console.log('✅ Completion Statistics:');
        console.log(`   Processed: ${completionStats.processed}`);
        console.log(`   Completed: ${completionStats.completed}`);
        console.log(`   Skipped: ${completionStats.skipped}`);
        console.log(`   Failed: ${completionStats.failed}`);
        console.log(`   Total Results Added: ${completionStats.totalResultsAdded}`);
        console.log(`   Elapsed Time: ${Math.round(completionStats.elapsedTime / 1000)}s`);
        console.log();

        // Test 6: Error logging
        console.log('🚨 Test 6: Error Logging...');
        
        const testError = new Error('Test error for logging');
        testError.stack = 'Test stack trace';
        
        progressReporter.logError(9999, testError, {
            operation: 'test_operation',
            additionalInfo: 'This is a test error'
        });
        
        console.log('✅ Error logging tested\n');

        // Test 7: Session data export
        console.log('💾 Test 7: Session Data Export...');
        
        const exportedData = progressReporter.exportSessionData();
        const parsedData = JSON.parse(exportedData);
        
        console.log('✅ Session data exported successfully');
        console.log(`   Export version: ${parsedData.version}`);
        console.log(`   Exported at: ${parsedData.exportedAt}`);
        console.log(`   Data size: ${exportedData.length} characters`);
        console.log();

        // Test 8: Logger child creation and log level management
        console.log('👶 Test 8: Logger Child Creation and Level Management...');
        
        const childLogger = logger.createChild('ChildComponent');
        childLogger.info('Testing child logger functionality');
        
        // Test log level changes
        logger.setLogLevel('warn');
        logger.debug('This debug message should not appear');
        logger.warn('This warning message should appear');
        
        logger.setLogLevel('info'); // Reset to info level
        
        console.log(`✅ Child logger created and log level management tested`);
        console.log(`   Current log level: ${logger.getLogLevel()}`);
        console.log();

        // Test 9: Session reset functionality
        console.log('🔄 Test 9: Session Reset Functionality...');
        
        const oldSessionId = progressReporter.sessionId;
        progressReporter.resetSession();
        const newSessionId = progressReporter.sessionId;
        
        console.log('✅ Session reset functionality tested');
        console.log(`   Old Session ID: ${oldSessionId}`);
        console.log(`   New Session ID: ${newSessionId}`);
        console.log(`   Sessions are different: ${oldSessionId !== newSessionId}`);
        console.log();

        // Test 10: Comprehensive error logging
        console.log('📝 Test 10: Comprehensive Error Logging...');
        
        const comprehensiveError = new Error('Comprehensive test error');
        comprehensiveError.stack = 'Comprehensive test stack trace';
        
        logger.logComprehensiveError('test_operation', comprehensiveError, {
            meetId: 2308,
            operation: 'scraping',
            additionalContext: 'Testing comprehensive error logging'
        });
        
        console.log('✅ Comprehensive error logging tested\n');

        console.log('🎉 All progress reporting and logging tests passed successfully!');
        
        return {
            success: true,
            testsRun: 10,
            componentsTested: ['ProgressReporter', 'ReImportLogger'],
            summaryReport: summaryReport
        };

    } catch (error) {
        console.error('❌ Progress reporting test failed:', error.message);
        console.error('Stack trace:', error.stack);
        
        return {
            success: false,
            error: error.message,
            testsRun: 0
        };
    }
}

// Run the test
testProgressReporting()
    .then(result => {
        if (result.success) {
            console.log('\n✅ All progress reporting tests completed successfully');
            process.exit(0);
        } else {
            console.log('\n❌ Progress reporting tests failed');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('\n💥 Test execution failed:', error.message);
        process.exit(1);
    });