# Requirements Document

## Introduction

Develop a comprehensive meet re-import system to re-scrape existing meets from Sport80 with improved Tier 2 verification and objective athlete verification capabilities. This system addresses cases where meets were previously imported but may have incomplete or incorrect athlete linkages due to pagination issues, missing internal_ids, or other scraping limitations.

## Glossary

- **Meet_Re_Import_System**: System component that re-scrapes and re-processes existing meets from Sport80
- **Tier_2_Verification**: Enhanced athlete verification process that handles pagination correctly when searching Sport80 athlete profiles
- **Existing_Meet**: A meet that already exists in the database but may have incomplete or incorrect athlete data
- **Gap_Meet**: A meet that doesn't exist in the database at all (handled by separate gap-filling scripts)
- **Internal_ID**: Unique Sport80 identifier for each athlete, found in profile links and division rankings
- **Tier_1_5_Extraction**: Process of extracting internal_ids from Sport80 division rankings using base64 lookups
- **Athlete_Linkage**: The connection between a meet result and the correct athlete record in the database
- **Pagination_Issue**: Problem where Tier 2 verification fails due to incomplete handling of paginated search results on Sport80
- **Membership_Number**: USAW membership identifier that provides objective athlete verification
- **Base64_URL**: Encoded URL used for Sport80 division rankings lookup

## Requirements

### Requirement 1: Existing Meet Identification

**User Story:** As a database administrator, I want to identify existing meets that need re-import, so that I can systematically improve data quality for previously processed meets.

#### Acceptance Criteria

1. WHEN querying the database, THE Meet_Re_Import_System SHALL identify meets that already exist in the database
2. WHEN filtering meets for re-import, THE Meet_Re_Import_System SHALL exclude gap meets (meets not in database)
3. WHEN selecting meets for processing, THE Meet_Re_Import_System SHALL allow filtering by date range, meet type, or specific meet IDs
4. WHEN generating candidate lists, THE Meet_Re_Import_System SHALL prioritize meets with known athlete linkage issues
5. WHEN processing large datasets, THE Meet_Re_Import_System SHALL handle batch selection efficiently

### Requirement 2: Enhanced Sport80 Re-Scraping

**User Story:** As a database administrator, I want to re-scrape meet data from Sport80 with improved extraction capabilities, so that I can capture data that was missed in previous imports.

#### Acceptance Criteria

1. WHEN re-scraping a meet, THE Meet_Re_Import_System SHALL fetch fresh data from Sport80 using the meet's Sport80 ID
2. WHEN extracting athlete data, THE Meet_Re_Import_System SHALL use improved Tier 2 verification with proper pagination handling
3. WHEN processing athlete profiles, THE Meet_Re_Import_System SHALL extract internal_ids using Tier 1.5 extraction methods
4. WHEN scraping fails, THE Meet_Re_Import_System SHALL log detailed error information and continue with other meets
5. WHEN rate limiting occurs, THE Meet_Re_Import_System SHALL implement appropriate delays and retry logic

### Requirement 3: Improved Tier 2 Verification

**User Story:** As a database administrator, I want Tier 2 verification to handle pagination correctly, so that athlete matching succeeds even when search results span multiple pages.

#### Acceptance Criteria

1. WHEN performing Tier 2 verification, THE Meet_Re_Import_System SHALL search all pages of Sport80 athlete search results
2. WHEN pagination is detected, THE Meet_Re_Import_System SHALL iterate through all available pages
3. WHEN matching athletes across pages, THE Meet_Re_Import_System SHALL maintain search context and parameters
4. WHEN verification succeeds, THE Meet_Re_Import_System SHALL extract the correct internal_id from the matched athlete profile
5. WHEN pagination fails, THE Meet_Re_Import_System SHALL log the failure and attempt alternative matching strategies

### Requirement 4: Objective Athlete Verification and Linking

**User Story:** As a database administrator, I want the system to use only objective, verifiable facts for athlete matching, so that linkages are accurate and reliable.

#### Acceptance Criteria

1. WHEN verifying athlete identity, THE Meet_Re_Import_System SHALL accept only lifter membership numbers that are linked to the meet in question
2. WHEN verifying athlete identity, THE Meet_Re_Import_System SHALL accept only lifter internal_ids that are linked to the meet in question
3. WHEN verifying athlete identity, THE Meet_Re_Import_System SHALL accept only cases where meet result is present on Sport80 athlete page AND athlete name is present on Sport80 meet page
4. WHEN comparing meet dates, THE Meet_Re_Import_System SHALL allow lift date +/- five days from the declared meet date as acceptable variance
5. WHEN objective verification fails, THE Meet_Re_Import_System SHALL NOT create athlete linkages and SHALL log the failure reason

### Requirement 5: Duplicate Resolution and Record Updates

**User Story:** As a database administrator, I want the system to resolve duplicate athlete records discovered during re-import, so that data integrity is maintained and improved.

#### Acceptance Criteria

1. WHEN discovering that an existing athlete should be linked to a different database record, THE Meet_Re_Import_System SHALL identify the correct target record using objective verification
2. WHEN resolving duplicates like Alvin Tajima (lifter_id 200589 should link to 1050), THE Meet_Re_Import_System SHALL update the linkage correctly
3. WHEN updating athlete linkages, THE Meet_Re_Import_System SHALL preserve all existing meet results and performance data
4. WHEN merging is required, THE Meet_Re_Import_System SHALL consolidate records while maintaining data integrity
5. WHEN updates are made, THE Meet_Re_Import_System SHALL log all changes for audit purposes

### Requirement 6: Internal_ID Enrichment

**User Story:** As a database administrator, I want existing athlete records to be enriched with internal_ids when they become available, so that future matching is more accurate.

#### Acceptance Criteria

1. WHEN processing athletes with newly extracted internal_ids, THE Meet_Re_Import_System SHALL update existing athlete records that lack internal_ids
2. WHEN an athlete record gains an internal_id, THE Meet_Re_Import_System SHALL verify the ID doesn't conflict with existing records
3. WHEN internal_id conflicts are detected, THE Meet_Re_Import_System SHALL flag the conflict for manual resolution
4. WHEN enrichment succeeds, THE Meet_Re_Import_System SHALL log the update for tracking purposes
5. WHEN enrichment fails, THE Meet_Re_Import_System SHALL continue processing without blocking other operations

### Requirement 7: Comprehensive Descriptive Logging

**User Story:** As a database administrator, I want detailed descriptive console logging of the re-import process, so that I can track progress and diagnose issues in real-time.

#### Acceptance Criteria

1. WHEN processing each lifter, THE Meet_Re_Import_System SHALL log descriptive information with empty lines between distinct lifter searches for readability
2. WHEN creating base64 URLs, THE Meet_Re_Import_System SHALL display the complete URL in the console log
3. WHEN performing Tier 2 verification, THE Meet_Re_Import_System SHALL log each page searched and results found
4. WHEN athlete linkages are updated, THE Meet_Re_Import_System SHALL log the old and new linkages with detailed reasoning
5. WHEN errors occur, THE Meet_Re_Import_System SHALL log comprehensive error details including Sport80 responses and database states

### Requirement 8: Same Name Different Athlete Handling

**User Story:** As a database administrator, I want the system to correctly handle multiple different athletes with the same name competing in the same meet, so that each athlete's results are stored separately without overwrites.

#### Acceptance Criteria

1. WHEN multiple athletes with identical names compete in the same meet, THE Meet_Re_Import_System SHALL treat them as separate individuals
2. WHEN athletes have the same name but different bodyweights, THE Meet_Re_Import_System SHALL create separate database records for each athlete
3. WHEN athletes have the same name but different weight classes, THE Meet_Re_Import_System SHALL store results for each weight class separately
4. WHEN disambiguating same-name athletes, THE Meet_Re_Import_System SHALL use objective criteria including bodyweight, weight class, and internal_id when available
5. WHEN same-name athletes are processed, THE Meet_Re_Import_System SHALL log the disambiguation process clearly showing how each athlete was identified

### Requirement 9: Selective Re-Import Capabilities

**User Story:** As a database administrator, I want to selectively re-import specific meets or athlete data, so that I can target known problem areas without reprocessing the entire database.

#### Acceptance Criteria

1. WHEN specifying re-import criteria, THE Meet_Re_Import_System SHALL allow filtering by meet ID, date range, athlete name, or data quality indicators
2. WHEN targeting specific athletes, THE Meet_Re_Import_System SHALL re-process all meets containing that athlete
3. WHEN focusing on problem cases, THE Meet_Re_Import_System SHALL prioritize meets with known linkage issues or missing internal_ids
4. WHEN running partial re-imports, THE Meet_Re_Import_System SHALL maintain consistency with non-reprocessed data
5. WHEN selective processing completes, THE Meet_Re_Import_System SHALL provide targeted reports on the specific improvements made