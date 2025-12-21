# Implementation Plan: Athlete Internal ID Extraction

## Overview

This implementation plan enhances the existing meet scraping system to extract athlete internal_ids during the scraping process. The approach focuses on minimal changes to preserve existing functionality while adding internal_id extraction capabilities.

## Tasks

- [ ] 1. Enhance athlete row processing to extract internal_ids
- [x] 1.1 Modify getAthletesOnPage function to extract internal_id from athlete name links
  - Update DOM parsing logic to check for profile links in athlete name cells
  - Add regex pattern matching for `/member/{id}` URL format
  - Include internal_id in athlete data structure
  - _Requirements: 1.1, 1.2_

- [x] 1.2 Write property test for internal_id extraction

  - **Property 1: Internal ID Extraction from Links**
  - **Validates: Requirements 1.1, 1.2**

- [x] 1.3 Update CSV output to include Internal_ID column
  - Modify CSV header generation to include "Internal_ID" column
  - Update athlete data serialization to include internal_id values
  - Ensure backward compatibility with existing CSV format
  - _Requirements: 1.3_

- [x] 1.4 Write property test for CSV output consistency

  - **Property 2: CSV Output Consistency**
  - **Validates: Requirements 1.3**

- [x] 1.5 Write property test for graceful processing

  - **Property 3: Graceful Processing Without Internal ID**
  - **Validates: Requirements 1.4**

- [x] 2. Integrate base64 lookup fallback for missing internal_ids
- [x] 2.1 Add base64 lookup integration to meet scraping workflow
  - Import existing scrapeDivisionRankings function from database-importer-custom.js
  - Add fallback logic to attempt base64 lookup for athletes missing internal_ids
  - Implement athlete data enrichment after successful lookups
  - _Requirements: 3.1, 3.2, 3.3_

- [ ]* 2.2 Write property test for base64 lookup fallback
  - **Property 7: Base64 Lookup Fallback Activation**
  - **Validates: Requirements 3.1**

- [ ]* 2.3 Write property test for successful lookup integration
  - **Property 8: Successful Lookup Integration**
  - **Validates: Requirements 3.2**

- [ ]* 2.4 Write property test for resilient processing
  - **Property 9: Resilient Processing on Lookup Failure**
  - **Validates: Requirements 3.3**

- [x] 3. Checkpoint - Ensure scraping enhancements work correctly
- Ensure all tests pass, ask the user if questions arise.

- [x] 4. Enhance database import logic to use internal_ids
- [x] 4.1 Modify athlete matching logic to prioritize internal_id
  - Update findOrCreateLifter function to check internal_id first
  - Preserve existing tier 1 and tier 2 verification systems
  - Add internal_id-based duplicate detection
  - _Requirements: 2.1, 2.2_

- [ ]* 4.2 Write property test for internal_id priority matching
  - **Property 4: Internal ID Priority in Matching**
  - **Validates: Requirements 2.1**

- [ ]* 4.3 Write property test for duplicate prevention
  - **Property 5: Duplicate Prevention via Internal ID**
  - **Validates: Requirements 2.2**

- [x] 4.4 Add internal_id enrichment for existing records
  - Implement logic to update existing athlete records with new internal_ids
  - Add conflict detection and logging for internal_id mismatches
  - Preserve data integrity during updates
  - _Requirements: 2.3, 2.4_

- [ ]* 4.5 Write property test for internal_id enrichment
  - **Property 6: Internal ID Enrichment**
  - **Validates: Requirements 2.3**

- [ ]* 4.6 Write unit tests for conflict logging
  - Test conflict detection and logging mechanisms
  - Verify appropriate error messages are generated
  - _Requirements: 2.4_

- [-] 5. Integration and testing
- [x] 5.1 Update scrape-missing-meet-ids-fixed.js to use enhanced functionality
  - Integrate enhanced athlete processing into main gap recovery script
  - Ensure compatibility with existing command-line parameters
  - Test with actual meet data to verify functionality
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3_

- [ ]* 5.2 Write integration tests for end-to-end functionality
  - Test complete workflow from meet scraping to database import
  - Verify internal_id extraction and matching work together
  - Test backward compatibility with existing data
  - _Requirements: All requirements_

- [x] 6. Final checkpoint - Ensure all functionality works correctly
- Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Existing tier 2 verification system is preserved and not modified
- All changes maintain backward compatibility with existing CSV processing
- Base64 lookup functionality reuses existing proven code from database-importer-custom.js