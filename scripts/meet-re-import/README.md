# Meet Re-Import System

A comprehensive system for identifying and re-importing incomplete meets from Sport80 with improved athlete matching capabilities.

## Overview

The Meet Re-Import System addresses cases where meets were previously imported but may have incomplete or incorrect athlete linkages due to pagination issues, missing internal_ids, or other scraping limitations. It compares result counts between Sport80 and the database to identify incomplete meets, then uses existing proven infrastructure to re-scrape and re-import missing results.

## Features

- **Intelligent Meet Detection**: Compares Sport80 vs database result counts to identify incomplete meets
- **Skip Management**: Avoids reprocessing already-complete meets for efficiency
- **Existing Infrastructure Integration**: Uses proven `scrapeOneMeet.js` and `database-importer-custom.js` components
- **Comprehensive Logging**: Detailed progress tracking and error reporting
- **Flexible Filtering**: Support for date ranges, specific meets, and athlete-based filtering
- **Batch Processing**: Configurable batch sizes with rate limiting
- **Dry Run Mode**: Preview operations without making changes

## Directory Structure

```
scripts/meet-re-import/
├── README.md                           # This file
├── re-import-meets.js                  # Main CLI script
├── index.js                            # Module exports
├── lib/                                # Core system components
│   ├── meet-completeness-engine.js     # Meet completeness analysis
│   ├── meet-skip-manager.js            # Skip logic and completion tracking
│   ├── re-import-orchestrator.js       # Main workflow orchestration
│   ├── progress-reporter.js            # Progress tracking and reporting
│   └── re-import-logger.js             # Comprehensive logging framework
└── types/                              # Type definitions and data models
    └── index.js                        # Core types and interfaces
```

## Core Components

### MeetCompletenessEngine
- Identifies incomplete meets by comparing result counts
- Handles meet filtering and completeness analysis
- Integrates with database queries and Sport80 scraping

### MeetSkipManager
- Tracks meet completion status to avoid reprocessing
- Manages in-memory cache for skip decisions
- Handles completion status persistence

### ReImportOrchestrator
- Coordinates the re-import workflow
- Integrates with existing `scrapeOneMeet.js` and `database-importer-custom.js`
- Provides error isolation and batch processing

### ProgressReporter
- Tracks detailed progress and statistics
- Generates comprehensive session reports
- Provides real-time progress updates

### ReImportLogger
- Comprehensive logging with multiple levels
- Descriptive console output with formatting
- Specialized logging for athlete processing and linkage updates

## Usage

### Command Line Interface

```bash
# Re-import specific meets
node scripts/meet-re-import/re-import-meets.js --meet-ids=2308,2357,2369

# Re-import meets from date range
node scripts/meet-re-import/re-import-meets.js --start-date=2024-01-01 --end-date=2024-12-31

# Re-import meets containing specific athlete
node scripts/meet-re-import/re-import-meets.js --athlete-name="Alvin Tajima"

# Dry run to preview operations
node scripts/meet-re-import/re-import-meets.js --dry-run --meet-ids=2308

# Custom batch processing
node scripts/meet-re-import/re-import-meets.js --batch-size=5 --delay=3000 --limit=50
```

### CLI Options

- `--meet-ids <ids>`: Comma-separated list of specific meet IDs
- `--start-date <date>`: Start date for date range filter (YYYY-MM-DD)
- `--end-date <date>`: End date for date range filter (YYYY-MM-DD)
- `--athlete-name <name>`: Re-import meets containing specific athlete
- `--batch-size <n>`: Number of meets to process in each batch (default: 10)
- `--delay <ms>`: Delay between meets in milliseconds (default: 2000)
- `--limit <n>`: Maximum number of meets to process
- `--timeout <ms>`: Timeout for each meet operation (default: 30000)
- `--log-level <level>`: Log level: error, warn, info, debug (default: info)
- `--dry-run, -d`: Show what would be done without actually doing it
- `--force, -f`: Force re-import even for complete meets
- `--help, -h`: Show help message
- `--version, -v`: Show version information

### Programmatic Usage

```javascript
const { createClient } = require('@supabase/supabase-js');
const { 
    MeetCompletenessEngine, 
    MeetSkipManager, 
    ReImportOrchestrator 
} = require('./scripts/meet-re-import');

// Initialize components
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const completenessEngine = new MeetCompletenessEngine(supabase);
const orchestrator = new ReImportOrchestrator(supabase);

// Find incomplete meets
const incompleteMeets = await completenessEngine.getIncompleteMeets({
    startDate: '2024-01-01',
    endDate: '2024-12-31'
});

// Process meets
for (const meet of incompleteMeets) {
    const result = await orchestrator.reImportMeet(meet.id, meet);
    console.log(`Meet ${meet.id}: ${result.success ? 'Success' : 'Failed'}`);
}
```

## Integration with Existing Infrastructure

The system leverages existing proven components without modification:

- **scrapeOneMeet.js**: Used for re-scraping meets with internal_id extraction and base64 lookup fallback
- **database-importer-custom.js**: Used for importing results with enhanced athlete matching and Tier 2 verification
- **searchSport80ForLifter.js**: Used for athlete verification when needed
- **division_base64_codes.json**: Used for base64 lookup fallback

## Data Models

### MeetCompletenessRecord
Tracks completeness status of meets based on result count comparison.

### ReImportSession
Tracks complete re-import sessions with statistics and results.

### MeetReImportResult
Result of re-importing a single meet with detailed metrics.

### MeetFilterCriteria
Criteria for filtering meets for re-import operations.

## Logging and Monitoring

The system provides comprehensive logging at multiple levels:

- **INFO**: Progress updates, successful operations
- **WARN**: Fallback strategies used, ambiguous matches
- **ERROR**: Failed operations, data integrity issues
- **DEBUG**: Detailed scraping and matching information

Log outputs include:
- Console output for real-time monitoring
- Detailed progress reports
- Session summaries with statistics
- Error reports for manual review

## Error Handling

The system implements robust error handling:

- **Error Isolation**: Failed meets don't stop processing of other meets
- **Graceful Degradation**: Fallback strategies for various failure modes
- **Comprehensive Logging**: Detailed error context for debugging
- **Retry Logic**: Configurable retry attempts for transient failures

## Configuration

The system supports extensive configuration options:

- Batch processing parameters
- Rate limiting and delays
- Timeout settings
- Logging levels and formats
- Skip behavior and caching
- Dry run and force modes

## Requirements

- Node.js 14+
- Supabase client configured
- Access to Sport80 (for scraping)
- Existing scraping infrastructure (scrapeOneMeet.js, etc.)

## Environment Variables

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SECRET_KEY=your_supabase_secret_key
```

## Development Status

This is the initial project structure and core interfaces. Implementation of specific functionality (Sport80 scraping, result count comparison, etc.) will be completed in subsequent tasks.

## Next Steps

1. Implement Sport80 result count extraction (Task 2.1)
2. Implement database result count queries (Task 2.3)
3. Implement result count comparison logic (Task 2.5)
4. Integrate with existing scraping infrastructure (Task 5.1)
5. Add comprehensive testing (Property-based and unit tests)