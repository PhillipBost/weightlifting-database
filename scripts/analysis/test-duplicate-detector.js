/* eslint-disable no-console */
/**
 * Test script for the duplicate detection engine
 * This script demonstrates the functionality and validates the implementation
 */

const { detectDuplicates, findNameDuplicates, calculateConfidenceScore } = require('./duplicate-detector.js');

async function testDuplicateDetector() {
    console.log('🧪 Testing Duplicate Detection Engine...\n');

    try {
        // Test 1: Find name duplicates
        console.log('Test 1: Finding name duplicates...');
        const nameDuplicates = await findNameDuplicates();
        console.log(`✅ Found ${nameDuplicates.length} name duplicate groups\n`);

        // Test 2: Test confidence scoring with mock data
        console.log('Test 2: Testing confidence scoring...');
        const mockCaseData = {
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

        const confidenceScore = calculateConfidenceScore(mockCaseData);
        console.log(`✅ Confidence score for mock case: ${confidenceScore}%\n`);

        // Test 3: Run limited duplicate detection (first 5 cases)
        console.log('Test 3: Running limited duplicate detection...');
        const duplicateCases = await detectDuplicates({
            minConfidence: 60,
            includePerformanceAnalysis: true
        });

        console.log(`✅ Found ${duplicateCases.length} high-confidence duplicate cases`);
        
        if (duplicateCases.length > 0) {
            console.log('\nSample case:');
            const sampleCase = duplicateCases[0];
            console.log(`  Case ID: ${sampleCase.case_id}`);
            console.log(`  Confidence: ${sampleCase.confidence_score}%`);
            console.log(`  Type: ${sampleCase.case_type}`);
            console.log(`  Athletes: ${sampleCase.athletes.length}`);
            console.log(`  Recommended Action: ${sampleCase.recommended_action}`);
            console.log(`  Notes: ${sampleCase.notes}`);
        }

        console.log('\n🎉 All tests completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    testDuplicateDetector();
}

module.exports = { testDuplicateDetector };