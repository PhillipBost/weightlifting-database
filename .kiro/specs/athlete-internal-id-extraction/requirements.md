# Requirements Document

## Introduction

Enhance the meet scraping system to extract athlete internal_ids during the scraping process to prevent duplicate athlete records in the database.

## Glossary

- **Meet_Scraper**: System component that scrapes meet data from Sport80
- **Internal_ID**: Unique Sport80 identifier for each athlete, found in profile links
- **Base64_Lookup**: Process of accessing Sport80 division rankings with encoded filters

## Requirements

### Requirement 1: Extract Internal IDs from Meet Data

**User Story:** As a data administrator, I want internal_ids extracted during meet scraping, so that I can prevent duplicate athlete records.

#### Acceptance Criteria

1. WHEN processing athlete rows, THE Meet_Scraper SHALL extract internal_id from athlete name href links
2. WHEN athlete name contains profile link, THE Meet_Scraper SHALL parse internal_id from `/member/{id}` URL pattern
3. WHEN internal_id is extracted, THE Meet_Scraper SHALL include it in the CSV output as a separate column
4. WHEN no internal_id is found, THE Meet_Scraper SHALL continue processing without failing

### Requirement 2: Use Internal IDs for Athlete Matching

**User Story:** As a data administrator, I want internal_ids used for athlete verification, so that I can accurately match athletes across meets.

#### Acceptance Criteria

1. WHEN importing athlete data with internal_ids, THE Database_Importer SHALL use internal_id as primary matching criterion
2. WHEN athlete has internal_id, THE Database_Importer SHALL check existing records before creating new ones
3. WHEN existing athlete lacks internal_id, THE Database_Importer SHALL update the record with the new internal_id
4. WHEN internal_id conflicts occur, THE Database_Importer SHALL log conflicts for manual resolution

### Requirement 3: Integrate Base64 Lookup for Missing IDs

**User Story:** As a data administrator, I want base64 lookup integrated into meet scraping, so that missing internal_ids are automatically retrieved.

#### Acceptance Criteria

1. WHEN athlete lacks internal_id, THE Meet_Scraper SHALL attempt base64 lookup using division rankings
2. WHEN base64 lookup succeeds, THE Meet_Scraper SHALL update athlete record with retrieved internal_id
3. WHEN base64 lookup fails, THE Meet_Scraper SHALL continue processing without the internal_id