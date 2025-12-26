# Implementation Plan: Meet Re-Import System

## Overview

This implementation plan creates a focused meet re-import system that identifies incomplete meets by comparing result counts and uses existing proven infrastructure for athlete matching when re-importing missing results.

## Tasks

- [x] 1. Set up project structure and core interfaces
  - Create directory structure for new components
  - Define core interfaces and types for meet completeness tracking
  - Set up logging framework for re-import operations
  - _Requirements: 1.1, 1.2_

- [ ] 2. Implement meet completeness analysis
  - [x] 2.1 Create Sport80 result count extractor
    - Write function to scrape Sport80 meet page and extract total result count
    - Handle pagination if results span multiple pages
    - Add error handling for missing or invalid meets
    - _Requirements: 1.1_

  - [ ]* 2.2 Write property test for Sport80 count extraction
    - **Property 1: Result Count Accuracy**
    - **Validates: Requirements 1.1**

  - [x] 2.3 Create database result count query
    - Write function to count existing results for a meet in database
    - Query meet_results table with proper filtering
    - _Requirements: 1.2_

  - [ ]* 2.4 Write property test for database count accuracy
    - **Property 2: Database Count Accuracy**
    - **Validates: Requirements 1.2**

  - [x] 2.5 Implement result count comparison logic
    - Compare Sport80 count vs database count
    - Determine if meet is complete or incomplete
    - Log discrepancies for analysis
    - _Requirements: 1.3, 1.4_

  - [ ]* 2.6 Write property tests for completeness detection
    - **Property 3: Completeness Detection**
    - **Property 4: Incomplete Meet Identification**
    - **Validates: Requirements 1.3, 1.4**

- [x] 3. Checkpoint - Ensure completeness analysis tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement meet skip management
  - [x] 4.1 Create meet completion tracker
    - Design data structure to track meet completion status
    - Implement functions to mark meets as complete
    - Add persistence layer for skip status
    - _Requirements: 8.1_

  - [ ]* 4.2 Write property test for skip status persistence
    - **Property 8: Skip Status Persistence**
    - **Validates: Requirements 8.1**

  - [x] 4.3 Implement skip decision logic
    - Check if meet should be skipped based on completion status
    - Verify result counts still match for previously complete meets
    - Handle edge cases (meets that become incomplete again)
    - _Requirements: 8.1_

  - [ ]* 4.4 Write unit tests for skip logic edge cases
    - Test meets that become incomplete after being marked complete
    - Test skip logic with various completion states
    - _Requirements: 8.1_

- [x] 5. Implement meet re-import orchestrator
  - [x] 5.1 Create main orchestrator class
    - Design workflow for processing incomplete meets
    - Integrate with existing scrapeOneMeet function
    - Integrate with existing processMeetCsvFile function
    - _Requirements: 2.1, 2.2_

  - [ ]* 5.2 Write property tests for scraping integration
    - **Property 5: Scraping Integration with Athlete Matching**
    - **Property 6: Import Integration with Enhanced Matching**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 5.3 Implement post-import verification
    - Verify result counts match after re-import
    - Mark meets as complete when successful
    - Handle partial import failures
    - _Requirements: 2.3_

  - [ ]* 5.4 Write property test for post-import verification
    - **Property 7: Post-Import Verification**
    - **Validates: Requirements 2.3**

  - [x] 5.5 Add error handling and isolation
    - Wrap each meet processing in try-catch blocks
    - Log errors but continue with other meets
    - Implement graceful degradation strategies
    - _Requirements: 2.4_

  - [ ]* 5.6 Write property test for error isolation
    - **Property 9: Error Isolation**
    - **Validates: Requirements 2.4**

- [x] 6. Checkpoint - Ensure orchestrator tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 7. Implement progress reporting and logging
  - [x] 7.1 Create progress tracking system
    - Track meets processed, completed, skipped, and failed
    - Log detailed progress for each meet
    - Generate session summaries
    - _Requirements: 7.4_

  - [ ]* 7.2 Write property test for progress reporting
    - **Property 10: Progress Reporting**
    - **Validates: Requirements 7.4**

  - [-] 7.3 Implement comprehensive logging
    - Log all operations with appropriate detail levels
    - Include error details and context
    - Format logs for easy analysis
    - _Requirements: 2.4, 7.4_

  - [ ]* 7.4 Write unit tests for logging functionality
    - Test log format and content
    - Test error logging scenarios
    - _Requirements: 2.4, 7.4_

- [x] 8. Create main re-import script
  - [x] 8.1 Build command-line interface
    - Support filtering by meet ID, date range
    - Add dry-run mode for testing
    - Include batch size and delay controls
    - _Requirements: 1.3, 8.1_

  - [x] 8.2 Wire all components together
    - Connect completeness analyzer, skip manager, and orchestrator
    - Implement main execution loop
    - Add configuration options and validation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_

  - [ ]* 8.3 Write integration tests for main script
    - Test end-to-end workflow with test data
    - Test command-line argument parsing
    - Test dry-run mode functionality
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 10. CRITICAL BUG FIX: Same Name Different Athletes Issue (CONSERVATIVE APPROACH WITH GUARDRAILS)
  - [x] 10.1 Analyze current athlete disambiguation logic (READ-ONLY ANALYSIS)
    - **GUARDRAIL**: NO CODE CHANGES - Analysis and documentation only
    - **GUARDRAIL**: Do not modify any existing files during analysis
    - Document current findOrCreateLifter() behavior with same-name athletes
    - Identify specific cases where Vanessa Rodriguez/Molly Raines overwrites occur
    - Map out existing Tier 1/Tier 2 verification flow that must be preserved
    - Document exact bodyweight differences in problem cases (Vanessa: different athletes, Molly: 47kg vs 82kg)
    - _Requirements: 8.1, 8.4_

  - [x] 10.2 Create isolated test environment with strict safety measures
    - **GUARDRAIL**: Create separate test script that does NOT touch production database
    - **GUARDRAIL**: Use completely fake test data only - no real meet IDs (use 99990-99999 range)
    - **GUARDRAIL**: Test script must include automatic cleanup and rollback functionality
    - **GUARDRAIL**: Test script must validate normal cases still work (Sebastian Flores type scenarios)
    - Create controlled test cases only for extreme bodyweight differences (40+ kg apart)
    - Test cases must prove normal matching (1-10kg differences) still uses existing athletes
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 10.3 Implement minimal targeted fix with extreme constraints
    - **GUARDRAIL**: Only modify disambiguation logic for extreme cases (40+ kg bodyweight difference AND different weight class categories)
    - **GUARDRAIL**: Preserve all existing Tier 1 and Tier 2 verification logic completely unchanged
    - **GUARDRAIL**: New logic only triggers as absolute last resort after all existing verification fails
    - **GUARDRAIL**: Must pass through existing verification first - no bypassing or short-circuiting
    - **GUARDRAIL**: Changes must be minimal and surgical - no refactoring of existing code
    - Add extreme difference detection only (40+ kg bodyweight AND completely different weight class categories like Youth vs Senior)
    - Only create new lifter when existing verification fails AND extreme differences detected
    - _Requirements: 8.2, 8.3, 8.4_

  - [x] 10.4 Add minimal logging for extreme cases only
    - **GUARDRAIL**: Only log when extreme differences are detected (40+ kg apart AND different categories)
    - **GUARDRAIL**: Do not add verbose logging to normal athlete matching flow
    - **GUARDRAIL**: Do not modify existing console output or logging patterns
    - Log only when new lifter is created due to extreme differences
    - Show specific criteria that triggered the extreme difference detection
    - _Requirements: 8.5_

  - [x] 10.5 Validate fix with comprehensive isolated testing
    - **GUARDRAIL**: Test only with fake data in completely isolated environment
    - **GUARDRAIL**: Verify normal cases (Sebastian Flores type: 1-5kg differences) still use existing athletes
    - **GUARDRAIL**: Verify moderate cases (10-20kg differences) still use existing athletes  
    - **GUARDRAIL**: Verify extreme cases (40+ kg differences) create new athletes only when verification fails
    - **GUARDRAIL**: Confirm zero regression in Tier 1/Tier 2 verification success rates
    - Test that existing athlete matching behavior is completely preserved
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 10.6 Production validation with extensive monitoring and rollback plan
    - **GUARDRAIL**: Deploy with extensive monitoring and immediate rollback capability
    - **GUARDRAIL**: Monitor for any increase in new lifter creation rates
    - **GUARDRAIL**: Immediate rollback if normal matching behavior changes at all
    - **GUARDRAIL**: Test on single low-risk meet first before any broader deployment
    - **GUARDRAIL**: Require explicit approval before processing any meet with existing results
    - Monitor that Sebastian Flores type cases continue to use existing athletes
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 11. Final validation checkpoint
  - Ensure all critical bug fixes pass tests
  - Verify same-name different-athlete scenarios work correctly
  - Confirm no data overwrites occur for legitimate separate athletes

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The system leverages existing proven athlete matching infrastructure
- No modifications to critical existing scripts (scrapeOneMeet.js, database-importer-custom.js)

## CRITICAL BUG FIXES - PHASE 3 (CORRECTED)

- [-] 12. Fix CSV column parsing bug in meet re-import system
  - [x] 12.1 Fix SmartImporter._parseScrapedData column mapping
    - **PROBLEM**: Using array indices instead of column names like working database-importer.js
    - **WORKING APPROACH**: `row['Best Snatch']`, `row['Body Weight (Kg)']`, `row.Lifter`
    - **BROKEN APPROACH**: `columns[11]`, `columns[4]`, `columns[3]`
    - Replace array index parsing with column name parsing to match working importer
    - _Requirements: Data integrity, correct parsing_

  - [x] 12.2 Fix DetailedOrchestrator._analyzeScrapedData parsing
    - **PROBLEM**: Assumes comma-separated format, should be pipe-separated
    - **WORKING APPROACH**: Parse with Papa.parse using pipe delimiter like database-importer.js
    - Replace simple line.split(',') with proper Papa.parse parsing
    - _Requirements: Data integrity, correct analysis_

- [x] 13. Enhance Tier 2 verification with bodyweight/total matching
  - [x] 13.1 Update verifyLifterParticipationInMeet function in database-importer-custom-extreme-fix.js
    - **PROBLEM**: Only checks meet name + date, ignores performance data
    - **SOLUTION**: Extract bodyweight from Sport80 member page and compare with expected
    - **SOLUTION**: Extract total from Sport80 member page and compare with expected
    - Add tolerance-based matching (±2kg bodyweight, ±5kg total)
    - Return verification result with performance match details
    - _Requirements: 3.3, 3.4, accurate athlete matching_

  - [x] 13.2 Update Tier 2 calls to pass expected bodyweight/total
    - **PROBLEM**: Tier 2 verification calls don't pass expected performance data
    - **SOLUTION**: Pass bodyweight and total from CSV data to verification function
    - Update function signature and all call sites
    - _Requirements: 3.3, 3.4, prevent incorrect assignments_

- [x] 14. Fix Vanessa Rodriguez incorrect assignment
  - [x] 14.1 Delete incorrect result from meet 7142
    - **SPECIFIC CASE**: Result assigned to lifter_id 4199 (internal_id 28381)
    - **PROBLEM**: BW=75.4kg, Total=130kg assigned to wrong athlete
    - **CORRECT TARGET**: Should be assigned to internal_id 59745
    - Query and delete the specific incorrect result
    - _Requirements: Data integrity, correct athlete assignment_

  - [x] 14.2 Re-import Vanessa Rodriguez with enhanced verification
    - Use enhanced Tier 2 verification to assign to correct athlete
    - Verify assignment to lifter with internal_id 59745
    - Confirm bodyweight and total match Sport80 member page data
    - _Requirements: 3.3, 3.4, correct athlete matching_

- [ ] 15. Test fixes with Vanessa Rodriguez case
  - [ ] 15.1 Test enhanced Tier 2 verification
    - Test internal_id 59745 (should match BW=75.4kg, Total=130kg)
    - Test internal_id 28381 (should NOT match BW=75.4kg, Total=130kg)
    - Verify tolerance ranges work correctly
    - _Requirements: 3.3, 3.4, system reliability_

  - [ ] 15.2 Test meet re-import system with fixes
    - Run re-import on meet 7142 with corrected CSV parsing
    - Verify Vanessa Rodriguez assigns to correct athlete (internal_id 59745)
    - Confirm no regressions in existing functionality
    - _Requirements: 1.1-1.5, 2.1-2.3, 3.1-3.4, 4.1-4.2_

- [ ] 16. Final validation checkpoint
  - Ensure all critical bugs are fixed
  - Verify Vanessa Rodriguez case is resolved correctly
  - Confirm system works end-to-end with correct data parsing