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

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The system leverages existing proven athlete matching infrastructure
- No modifications to critical existing scripts (scrapeOneMeet.js, database-importer-custom.js)