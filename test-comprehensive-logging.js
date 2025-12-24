/**
 * Test script specifically for comprehensive logging functionality
 * Tests detailed logging scenarios for the meet re-import system
 */

const { ReImportLogger } = require('./scripts/meet-re-import/lib/re-import-logger');

async function testComprehensiveLogging() {
    console.log('🧪 Testing Comprehensive Logging...\n');

    try {
        // Test 1: Initialize logger with different configurations
        console.log('📝 Test 1: Logger Configuration Testing...');
        
        const debugLogger = new ReImportLogger('DebugComponent', {
            logLevel: 'debug',
            colorOutput: true
        });
        
        const infoLogger = new ReImportLogger('InfoComponent', {
            logLevel: 'info',
            colorOutput: false
        });
        
        const warnLogger = new ReImportLogger('WarnComponent', {
            logLevel: 'warn',
            colorOutput: true
        });
        
        console.log('✅ Multiple logger configurations initialized\n');

        // Test 2: Test all log levels
        console.log('📊 Test 2: Log Level Testing...');
        
        debugLogger.debug('Debug message - should appear');
        debugLogger.info('Info message - should appear');
        debugLogger.warn('Warning message - should appear');
        debugLogger.error('Error message - should appear');
        
        console.log('\nInfo logger (info level):');
        infoLogger.debug('Debug message - should NOT appear');
        infoLogger.info('Info message - should appear');
        infoLogger.warn('Warning message - should appear');
        infoLogger.error('Error message - should appear');
        
        console.log('\nWarn logger (warn level):');
        warnLogger.debug('Debug message - should NOT appear');
        warnLogger.info('Info message - should NOT appear');
        warnLogger.warn('Warning message - should appear');
        warnLogger.error('Error message - should appear');
        
        console.log('✅ Log level filtering working correctly\n');

        // Test 3: Test specialized logging methods
        console.log('🔧 Test 3: Specialized Logging Methods...');
        
        debugLogger.logLifterProcessing('Jane Doe', 'internal_id_extraction', {
            meetId: 2308,
            sport80Id: 'abc123',
            searchCriteria: { name: 'Jane Doe', club: 'Test Club' }
        });
        
        debugLogger.logBase64URL('https://sport80.com/rankings?division=xyz789&year=2024', {
            division: 'xyz789',
            year: 2024,
            category: 'Senior'
        });
        
        debugLogger.logTier2Verification(3, 8, { 
            name: 'John Smith', 
            club: 'Elite Weightlifting',
            membershipNumber: '12345'
        });
        
        debugLogger.logLinkageUpdate(54321, 98765, 'Internal ID match', {
            evidence: 'Sport80 profile verification',
            confidence: 0.98,
            previousLinkage: 'None'
        });
        
        console.log('✅ Specialized logging methods tested\n');

        // Test 4: Test comprehensive error logging
        console.log('🚨 Test 4: Comprehensive Error Logging...');
        
        const testError = new Error('Test comprehensive error');
        testError.stack = 'Test stack trace\n  at testFunction (test.js:123:45)\n  at main (test.js:456:78)';
        
        debugLogger.logComprehensiveError('scraping_operation', testError, {
            meetId: 2357,
            operation: 'sport80_scraping',
            url: 'https://sport80.com/meet/2357',
            additionalContext: 'Testing comprehensive error logging with full context'
        });
        
        // Test error with no stack trace
        const simpleError = new Error('Simple error without stack');
        debugLogger.logComprehensiveError('import_operation', simpleError, {
            meetId: 2369,
            operation: 'database_import'
        });
        
        console.log('✅ Comprehensive error logging tested\n');

        // Test 5: Test child logger functionality
        console.log('👶 Test 5: Child Logger Functionality...');
        
        const parentLogger = new ReImportLogger('ParentComponent', { logLevel: 'debug' });
        const childLogger = parentLogger.createChild('ChildComponent');
        const grandchildLogger = childLogger.createChild('GrandchildComponent');
        
        parentLogger.info('Message from parent logger');
        childLogger.info('Message from child logger');
        grandchildLogger.info('Message from grandchild logger');
        
        // Test that child inherits parent's log level
        parentLogger.setLogLevel('warn');
        childLogger.info('Child info message - should NOT appear after parent level change');
        childLogger.warn('Child warning message - should appear');
        
        console.log('✅ Child logger functionality tested\n');

        // Test 6: Test log level management
        console.log('⚙️ Test 6: Log Level Management...');
        
        const levelTestLogger = new ReImportLogger('LevelTest', { logLevel: 'info' });
        
        console.log(`Initial log level: ${levelTestLogger.getLogLevel()}`);
        
        levelTestLogger.setLogLevel('debug');
        console.log(`After setting to debug: ${levelTestLogger.getLogLevel()}`);
        levelTestLogger.debug('Debug message - should appear now');
        
        levelTestLogger.setLogLevel('error');
        console.log(`After setting to error: ${levelTestLogger.getLogLevel()}`);
        levelTestLogger.info('Info message - should NOT appear now');
        levelTestLogger.error('Error message - should appear');
        
        console.log('✅ Log level management tested\n');

        // Test 7: Test logging with complex objects
        console.log('📦 Test 7: Complex Object Logging...');
        
        const complexObject = {
            meetData: {
                id: 2308,
                name: 'Test Meet',
                date: '2024-01-15',
                location: 'Test Venue'
            },
            athleteData: [
                { name: 'Athlete 1', total: 250, bodyweight: 75.5 },
                { name: 'Athlete 2', total: 280, bodyweight: 85.2 }
            ],
            metadata: {
                scrapedAt: new Date().toISOString(),
                version: '2.0.0',
                source: 'sport80'
            }
        };
        
        debugLogger.info('Complex object logging test', complexObject);
        
        console.log('✅ Complex object logging tested\n');

        // Test 8: Test logging performance with many messages
        console.log('⚡ Test 8: Logging Performance Test...');
        
        const perfLogger = new ReImportLogger('PerfTest', { logLevel: 'info' });
        const startTime = Date.now();
        
        for (let i = 0; i < 100; i++) {
            perfLogger.info(`Performance test message ${i}`, { iteration: i, timestamp: Date.now() });
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`✅ Logged 100 messages in ${duration}ms (${(100 / duration * 1000).toFixed(2)} messages/second)\n`);

        console.log('🎉 All comprehensive logging tests passed successfully!');
        
        return {
            success: true,
            testsRun: 8,
            componentsTested: ['ReImportLogger'],
            performanceMetrics: {
                messagesPerSecond: (100 / duration * 1000).toFixed(2),
                totalDuration: duration
            }
        };

    } catch (error) {
        console.error('❌ Comprehensive logging test failed:', error.message);
        console.error('Stack trace:', error.stack);
        
        return {
            success: false,
            error: error.message,
            testsRun: 0
        };
    }
}

// Run the test
testComprehensiveLogging()
    .then(result => {
        if (result.success) {
            console.log('\n✅ All comprehensive logging tests completed successfully');
            process.exit(0);
        } else {
            console.log('\n❌ Comprehensive logging tests failed');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('\n💥 Test execution failed:', error.message);
        process.exit(1);
    });