# Requirements Document: Athlete Matching Fix

## Introduction

The current athlete matching system is failing to correctly match existing athletes who already have internal_ids in the database. Specifically, when processing meet results, athletes like Lindsey Powell (internal_id: 38394) who exist in the database with internal_ids are not being matched, leading to either skipped results or duplicate athlete records.

## Glossary

- **System**: The athlete matching and import system
- **Internal_ID**: Sport80's unique identifier for an athlete (extracted from member URLs)
- **Lifter_ID**: Database primary key for athlete records
- **Meet_Result**: A record of an athlete's performance at a specific meet
- **CSV_Data**: Scraped meet data containing athlete names and internal_ids

## Requirements

### Requirement 1: Accurate Internal_ID Matching

**User Story:** As a data importer, I want the system to correctly match athletes by internal_id, so that existing athletes are properly linked to their meet results.

#### Acceptance Criteria

1. WHEN processing a meet result with an internal_id, THE System SHALL query the database for existing athletes with that internal_id
2. WHEN an existing athlete is found with matching internal_id, THE System SHALL use that athlete's lifter_id for the meet result
3. WHEN the internal_id match is found, THE System SHALL NOT create a duplicate athlete record
4. WHEN the internal_id match is found, THE System SHALL NOT skip the athlete's result

### Requirement 2: Diagnostic Logging

**User Story:** As a developer, I want detailed logging of the matching process, so that I can diagnose why specific athletes are not being matched.

#### Acceptance Criteria

1. WHEN processing each athlete, THE System SHALL log the internal_id being searched
2. WHEN querying the database, THE System SHALL log the query parameters and results
3. WHEN a match is found, THE System SHALL log the matched lifter_id and athlete name
4. WHEN no match is found, THE System SHALL log why the match failed

### Requirement 3: Fallback Matching Strategy

**User Story:** As a data importer, I want the system to have a clear fallback strategy when internal_id matching fails, so that no athlete data is lost.

#### Acceptance Criteria

1. WHEN internal_id matching fails, THE System SHALL attempt name-based matching
2. WHEN name-based matching finds multiple candidates, THE System SHALL use verification to disambiguate
3. WHEN all matching strategies fail, THE System SHALL create a new athlete record with available data
4. THE System SHALL log which matching strategy was used for each athlete

### Requirement 4: Test Case for Known Athletes

**User Story:** As a developer, I want to test the matching logic with known athletes, so that I can verify the fix works correctly.

#### Acceptance Criteria

1. THE System SHALL correctly match Lindsey Powell (internal_id: 38394) to her existing database record
2. THE System SHALL correctly import her meet 2308 result
3. THE System SHALL NOT create duplicate records for Lindsey Powell
4. THE System SHALL provide a test script that validates matching for known athletes
