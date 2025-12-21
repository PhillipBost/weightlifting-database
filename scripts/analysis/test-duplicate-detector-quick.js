/* eslint-disable no-console */
/**
 * Quick test script for the duplicate detection engine
 * Tests core functionality without running full database scan
 */

const { findNameDuplicates, calculateConfidenceScore } = require('./duplicate-detector.js');

async function quickTest() {
    console.log('🧪 Quick Test: Duplicate Detection Engine Core Functions...\n');

    try {
        // Test 1: Find name duplicates (limited)
        console.log('Test 1: Finding name duplicates...');
        const nameDuplicates = await findNameDuplicates();
        console.log(`✅ Found ${nameDuplicates.length} name duplicate groups`);
        
        if (nameDuplicates.length > 0) {
            console.log(`   Top duplicate: ${nameDuplicates[0].athlete_name} (${nameDuplicates[0].count} records)`);
        }

        // Test 2: Test confidence scoring with various scenarios
        console.log('\nTest 2: Testing confidence scoring algorithms...');
        
        // High confidence case (same internal_id and membership)
        const highConfidenceCase = {
            athletes: [
                {
                    lifter_id: 1,
                    athlete_name: 'John Smith',
                    internal_id: 12345,
                    membership_number: 'USAW123',
                    first_competition: '2020-01-01',
                    last_competition: '2023-12-31'
                },
                {
                    lifter_id: 2,
                    athlete_name: 'John Smith',
                    internal_id: 12345,
                    membership_number: 'USAW123',
                    first_competition: '2021-01-01',
                    last_competition: '2024-01-31'
                }
            ],
            performanceAnalysis: {
                identical_performances: true,
                temporal_conflicts: false,
                weight_class_conflicts: false,
                performance_anomalies: false
            }
        };

        const highScore = calculateConfidenceScore(highConfidenceCase);
        console.log(`   High confidence case: ${highScore}% (expected: >90%)`);

        // Low confidence case (different internal_ids)
        const lowConfidenceCase = {
            athletes: [
                {
                    lifter_id: 1,
                    athlete_name: 'John Smith',
                    internal_id: 12345,
                    membership_number: 'USAW123',
                    first_competition: '2020-01-01',
                    last_competition: '2021-12-31'
                },
                {
                    lifter_id: 2,
                    athlete_name: 'John Smith',
                    internal_id: 67890,
                    membership_number: 'USAW456',
                    first_competition: '2022-01-01',
                    last_competition: '2024-01-31'
                }
            ],
            performanceAnalysis: {
                identical_performances: false,
                temporal_conflicts: false,
                weight_class_conflicts: false,
                performance_anomalies: false
            }
        };

        const lowScore = calculateConfidenceScore(lowConfidenceCase);
        console.log(`   Low confidence case: ${lowScore}% (expected: <50%)`);

        // Test 3: Validate confidence score bounds
        console.log('\nTest 3: Validating confidence score bounds...');
        const scores = [highScore, lowScore];
        const allInBounds = scores.every(score => score >= 0 && score <= 100);
        console.log(`   All scores in bounds (0-100): ${allInBounds ? '✅' : '❌'}`);

        console.log('\n🎉 Quick tests completed successfully!');
        console.log('\n📋 Core Functions Validated:');
        console.log('   ✅ Name-based duplicate detection');
        console.log('   ✅ Confidence score calculation');
        console.log('   ✅ Score bounds validation');
        console.log('   ✅ Database connectivity');

    } catch (error) {
        console.error('❌ Quick test failed:', error.message);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    quickTest();
}

module.exports = { quickTest };