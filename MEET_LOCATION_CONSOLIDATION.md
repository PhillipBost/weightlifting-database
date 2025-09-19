# Meet Location Consolidation Implementation Guide

## Overview

This guide details the implementation of consolidated meet location data in the `meets` table, replacing the previous split architecture between `meets` and `meet_locations` tables. The new approach follows the same pattern as the `clubs` table, storing all location-related data in a single table.

## Changes Made

### 1. Database Schema Updates

#### New fields added to `meets` table:
- `address` (TEXT) - Raw scraped address from meet listings
- `street_address` (TEXT) - Parsed street address component
- `city` (TEXT) - Parsed city component
- `state` (TEXT) - Parsed state/province component
- `zip_code` (TEXT) - Parsed postal code component
- `country` (TEXT) - Parsed country component
- `latitude` (NUMERIC) - Geocoded latitude coordinate
- `longitude` (NUMERIC) - Geocoded longitude coordinate
- `elevation_meters` (NUMERIC) - Elevation above sea level in meters
- `elevation_source` (TEXT) - Source of elevation data (Open-Meteo, Open-Elevation, etc.)
- `elevation_fetched_at` (TIMESTAMP) - Timestamp when elevation was fetched
- `geocode_display_name` (TEXT) - Full geocoded address returned by geocoding service
- `geocode_precision_score` (INTEGER) - Geocoding confidence score (higher = more precise)
- `geocode_success` (BOOLEAN) - Whether geocoding was successful
- `geocode_error` (TEXT) - Error message if geocoding failed
- `geocode_strategy_used` (TEXT) - Which geocoding strategy succeeded (original, suite-removed, street-only, etc.)
- `location_text` (TEXT) - Original location text from scraped data
- `date_range` (TEXT) - Date range from scraped meet data
- `wso_geography` (TEXT) - WSO geographic region based on boundary definitions

#### New field added to `clubs` table:
- `wso_geography` (TEXT) - WSO geographic region based on boundary definitions

### 2. Script Updates

#### Updated `geocode-and-import.js`:
- **Now targets `meets` table instead of `meet_locations`**
- Includes WSO geography assignment during geocoding
- Tracks geocoding strategy used (which attempt succeeded)
- Populates all new location fields including elevation placeholders
- Uses meet_id as primary key for updates

#### Updated `elevation-fetcher.js`:
- Added support for `meets` table elevation fetching
- Maintains existing `clubs` table support
- Added command-line options for selective processing
- Keeps legacy `meet_locations` support during transition

#### New utilities:
- `utils/wso-geography-lookup.js` - WSO geography determination based on coordinates and `wso_information` table boundaries

### 3. New Schema Management

#### Schema files:
- `scripts/schema/add-location-fields-to-meets.sql` - SQL to add location fields to meets table
- `scripts/schema/add-wso-geography-to-clubs.sql` - SQL to add WSO geography to clubs table
- `scripts/schema/apply-schema-changes.js` - Script to apply schema changes with verification

## Implementation Steps

### Step 1: Apply Database Schema Changes

```bash
# Apply the new schema
node scripts/schema/apply-schema-changes.js
```

This script will:
- Check current schema state
- Add missing columns to `meets` and `clubs` tables
- Verify changes were applied successfully
- Log any statements that need manual execution

### Step 2: Process Meet Address Data

```bash
# 1. First, scrape meet addresses (existing script, no changes needed)
node scripts/production/meet-address-scraper.js --year 2024

# 2. Geocode and import to meets table (updated script)
node scripts/geographic/geocode-and-import.js
```

The geocoding script will:
- Read meet addresses from JSON files
- Geocode addresses using multiple strategies
- Determine WSO geography from coordinates
- Update `meets` table with all location data

### Step 3: Add Elevation Data

```bash
# Add elevation data to meets table
node scripts/geographic/elevation-fetcher.js --meets

# Or process all tables
node scripts/geographic/elevation-fetcher.js --all
```

Available options:
- `--meets` - Process only meets table
- `--clubs` - Process only clubs table  
- `--meet-locations` - Process legacy meet_locations table
- `--all` - Process all tables (default)

### Step 4: Assign WSO Geography (if needed separately)

The WSO geography assignment happens automatically during geocoding, but if you need to run it separately:

```bash
# Run existing WSO geography assignment script
# (This script should be updated to target both meets and clubs tables)
```

## Data Flow

### Before (Split Architecture)
```
meet-address-scraper.js → meet_addresses.json → geocode-and-import.js → meet_locations table
                                                                      ↓
elevation-fetcher.js → meet_locations table (elevation data)
```

### After (Consolidated Architecture)
```
meet-address-scraper.js → meet_addresses.json → geocode-and-import.js → meets table (all location data)
                                                                      ↓
elevation-fetcher.js → meets table (elevation data)
wso-geography-assignment → meets table (WSO regions)
```

## Key Benefits

1. **Simplified Architecture**: Single source of truth for meet data
2. **Consistent Pattern**: Follows same approach as `clubs` table
3. **Enhanced Tracking**: Comprehensive metadata for geocoding and elevation
4. **WSO Integration**: Built-in geographic region assignment
5. **No Migration Risk**: Fresh data processing approach

## Transition Notes

- **No data migration required**: Using fresh data processing approach
- **Legacy support maintained**: `meet_locations` table remains untouched during transition
- **Backward compatibility**: Existing scripts can continue to work with `meet_locations`
- **Gradual transition**: Can phase out old table once new approach is proven

## Verification

### Check Schema Changes
```bash
# Verify new columns exist
node scripts/maintenance/check-database-schema.js
```

### Test Scripts
```bash
# Test with small dataset first
node scripts/geographic/geocode-and-import.js --limit 10
node scripts/geographic/elevation-fetcher.js --meets --limit 10
```

### Data Quality Checks
- Verify geocoding success rates
- Check WSO geography assignment accuracy
- Confirm elevation data population
- Validate address parsing quality

## Troubleshooting

### Schema Application Issues
- If `apply-schema-changes.js` fails, check logs for SQL statements that need manual execution
- Verify database permissions for DDL operations
- Check for naming conflicts with existing columns

### Geocoding Issues
- Check Nominatim API rate limiting
- Verify address data quality in input files
- Review geocoding strategy success rates in logs

### WSO Geography Issues
- Verify `wso_information` table has boundary data
- Check coordinate validation in WSO lookup utility
- Ensure boundary checking logic matches your data format

## Files Modified/Created

### New Files
- `scripts/schema/add-location-fields-to-meets.sql`
- `scripts/schema/add-wso-geography-to-clubs.sql`
- `scripts/schema/apply-schema-changes.js`
- `utils/wso-geography-lookup.js`
- `MEET_LOCATION_CONSOLIDATION.md`

### Modified Files
- `scripts/geographic/geocode-and-import.js` - Updated to target meets table
- `scripts/geographic/elevation-fetcher.js` - Added meets table support

### Unchanged Files
- `scripts/production/meet-address-scraper.js` - No changes needed
- `scripts/geographic/elevation-fetcher.js` - Legacy functionality preserved

## Next Steps

1. **Test the implementation** with sample data
2. **Run schema changes** on production database
3. **Process historical data** using updated scripts
4. **Monitor data quality** and geocoding success rates
5. **Gradually phase out** `meet_locations` table usage
6. **Update documentation** and other dependent scripts