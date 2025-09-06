-- Test Script for Meet Results Analytics System
-- This script tests the analytics functions and triggers with sample data

-- Create temporary test table to avoid affecting real data during testing
CREATE TEMPORARY TABLE test_meet_results (LIKE meet_results INCLUDING ALL);

-- Insert test data to validate calculations
INSERT INTO test_meet_results (
    meet_id, lifter_id, meet_name, date, age_category, weight_class, 
    lifter_name, body_weight_kg,
    snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
    cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total,
    manual_override
) VALUES 
-- Test Case 1: Perfect lifter (all lifts successful)
(1001, 100, 'Test Meet 1', '2024-01-15', 'Open', '81kg', 'Perfect Lifter', '80.5',
 '100', '105', '110', '110', '130', '135', '140', '140', '250', FALSE),

-- Test Case 2: Struggling lifter (multiple misses and bounce-backs) 
(1002, 101, 'Test Meet 2', '2024-02-10', 'Open', '81kg', 'Bouncer', '80.8',
 '-95', '100', '-105', '100', '-125', '-130', '130', '130', '230', FALSE),

-- Test Case 3: Same lifter later in year (for YTD testing)
(1003, 100, 'Test Meet 3', '2024-03-20', 'Open', '81kg', 'Perfect Lifter', '81.0',
 '105', '115', '-120', '115', '135', '145', '-150', '145', '260', FALSE),

-- Test Case 4: Manual override case (should skip auto-calculation)
(1004, 102, 'Test Meet 4', '2024-04-05', 'Open', '73kg', 'Manual Entry', '72.5',
 '90', '95', '100', '100', '115', '120', '125', '125', '225', TRUE);

-- Test 1: Verify basic function calculations
SELECT 
    '=== TEST 1: Basic Function Tests ===' as test_section;

-- Test successful attempts counting
SELECT 
    'Success Count Tests' as test_name,
    count_successful_attempts('100', '105', '110') as perfect_snatch_should_be_3,
    count_successful_attempts('-95', '100', '-105') as mixed_snatch_should_be_1,
    count_successful_attempts('null', 'invalid', '100') as with_invalid_should_be_1;

-- Test bounce-back calculation
SELECT 
    'Bounce-back Tests' as test_name,
    calculate_bounce_back('-95', '100') as miss_then_make_should_be_true,
    calculate_bounce_back('95', '100') as make_then_make_should_be_false,
    calculate_bounce_back('-95', '-100') as miss_then_miss_should_be_false;

-- Test 2: Test complete analytics calculation
SELECT 
    '=== TEST 2: Complete Analytics Calculation ===' as test_section;

SELECT 
    lifter_name,
    date,
    (SELECT * FROM calculate_meet_result_analytics(
        lifter_id, date, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
        cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total
    )) as analytics
FROM test_meet_results
ORDER BY date;

-- Test 3: Test triggers by inserting new records
SELECT 
    '=== TEST 3: Trigger Testing ===' as test_section;

-- First, create triggers on our temp table
CREATE TRIGGER test_analytics_insert_trigger
    BEFORE INSERT ON test_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION calculate_and_set_analytics();

-- Insert a new record and see if analytics are calculated automatically
INSERT INTO test_meet_results (
    meet_id, lifter_id, meet_name, date, age_category, weight_class,
    lifter_name, body_weight_kg,
    snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
    cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total,
    manual_override
) VALUES (
    1005, 103, 'Trigger Test Meet', '2024-05-01', 'Open', '89kg', 
    'Trigger Tester', '88.2',
    '-80', '85', '-90', '85', '100', '-110', '110', '110', '195', FALSE
);

-- Check if the analytics were calculated automatically
SELECT 
    'Trigger Test Results' as test_name,
    lifter_name,
    snatch_successful_attempts,
    cj_successful_attempts, 
    total_successful_attempts,
    bounce_back_snatch_2,
    bounce_back_snatch_3,
    bounce_back_cj_2,
    bounce_back_cj_3
FROM test_meet_results 
WHERE lifter_name = 'Trigger Tester';

-- Test 4: YTD Calculation Validation
SELECT 
    '=== TEST 4: YTD Calculation Validation ===' as test_section;

-- Check YTD progression for Perfect Lifter (lifter_id = 100)
SELECT 
    'YTD Progression Test' as test_name,
    lifter_name,
    date,
    best_snatch,
    best_snatch_ytd,
    best_cj,
    best_cj_ytd,
    total,
    best_total_ytd
FROM test_meet_results 
WHERE lifter_id = 100
ORDER BY date;

-- Expected results:
-- Jan 15: snatch_ytd=110, cj_ytd=140, total_ytd=250
-- Mar 20: snatch_ytd=115, cj_ytd=145, total_ytd=260

-- Test 5: Edge Cases and Error Handling
SELECT 
    '=== TEST 5: Edge Cases and Error Handling ===' as test_section;

-- Test with NULL and invalid values
INSERT INTO test_meet_results (
    meet_id, lifter_id, meet_name, date, age_category, weight_class,
    lifter_name, body_weight_kg,
    snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
    cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total,
    manual_override
) VALUES (
    1006, 104, 'Edge Case Meet', '2024-06-01', 'Open', '96kg',
    'Edge Case Lifter', '95.0',
    NULL, 'invalid', '0', '0', '', '-120', NULL, '0', '0', FALSE
);

-- Check how the system handles edge cases
SELECT 
    'Edge Case Results' as test_name,
    lifter_name,
    snatch_successful_attempts,
    cj_successful_attempts,
    total_successful_attempts,
    best_snatch_ytd,
    best_cj_ytd,
    best_total_ytd
FROM test_meet_results 
WHERE lifter_name = 'Edge Case Lifter';

-- Test 6: Manual Override Testing
SELECT 
    '=== TEST 6: Manual Override Testing ===' as test_section;

-- Check that manual override records don't get auto-calculated analytics
SELECT 
    'Manual Override Test' as test_name,
    lifter_name,
    manual_override,
    snatch_successful_attempts,
    cj_successful_attempts,
    total_successful_attempts
FROM test_meet_results 
WHERE manual_override = TRUE;

-- Summary Report
SELECT 
    '=== SUMMARY REPORT ===' as test_section;

SELECT 
    COUNT(*) as total_test_records,
    COUNT(*) FILTER (WHERE snatch_successful_attempts IS NOT NULL) as records_with_snatch_analytics,
    COUNT(*) FILTER (WHERE cj_successful_attempts IS NOT NULL) as records_with_cj_analytics,
    COUNT(*) FILTER (WHERE best_snatch_ytd IS NOT NULL) as records_with_ytd_analytics,
    COUNT(*) FILTER (WHERE manual_override = TRUE) as manual_override_records
FROM test_meet_results;

-- Detailed results for review
SELECT 
    'Detailed Test Results' as summary,
    lifter_name,
    date,
    snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
    cj_lift_1, cj_lift_2, cj_lift_3, best_cj,
    total,
    snatch_successful_attempts,
    cj_successful_attempts,
    total_successful_attempts,
    best_snatch_ytd,
    best_cj_ytd,
    best_total_ytd,
    bounce_back_snatch_2,
    bounce_back_snatch_3,
    bounce_back_cj_2,
    bounce_back_cj_3
FROM test_meet_results
ORDER BY date;

-- Clean up test data
DROP TABLE test_meet_results;