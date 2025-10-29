# IWF Meet Locations Implementation

## Overview
This implementation enables automatic population of the `iwf_meet_locations` table with:
- Location data (city, country) from IWF event discovery
- Human-readable country names (instead of 3-letter codes)
- Geocoded latitude/longitude via Nominatim OpenStreetMap API

## Architecture

### Data Flow
```
Event Discovery (iwf_events_YYYY.json)
    ↓ [location_city, location_country]
    ↓
extractMeetMetadata() 
    ↓ [passes location fields]
    ↓
parseLocationData()
    ↓ [converts CHN → China, NOR → Norway]
    ↓
upsertIWFMeetLocation()
    ↓ [geocodes city + country]
    ↓
iwf_meet_locations table ✓
```

### Files Modified

#### 1. `scripts/production/iwf-meet-manager.js`
- **`extractMeetMetadata()`**: Now extracts `location_city` and `location_country` from event JSON
- **`parseLocationData()`**: Converts country codes to full names using `mapCountryCodeToName()`
- **`geocodeLocation()`**: NEW - Uses Nominatim API to get lat/long from city + country
- **`upsertIWFMeetLocation(meetId, locationData, shouldGeocode)`**: Enhanced to geocode locations with 1-second rate limiting

#### 2. `scripts/production/iwf-database-importer.js`
- **Line 238**: Changed from `meet.db_meet_id` to `meet.iwf_meet_id` when calling `upsertIWFMeetLocation()`

#### 3. `migrations/create-iwf-meet-locations.sql` (NEW)
- Creates `iwf_meet_locations` table
- FK: `iwf_meet_locations.iwf_meet_id` → `iwf_meets.iwf_meet_id`
- Includes geocoding fields (latitude, longitude)
- Auto-triggers `updated_at` timestamps

## Database Migration

**IMPORTANT:** Run this migration manually before using the new code:

```bash
# Using psql directly
psql -h your-host -U your-user -d your-database < migrations/create-iwf-meet-locations.sql
```

The migration will:
1. Drop existing `iwf_meet_locations` table (if present)
2. Create new table with correct FK relationship
3. Setup indexes and triggers

## Usage Example

```bash
# Single event import (auto-populates location with geocoding)
node scripts/production/iwf-database-importer.js \
  --event-id 661 \
  --year 2025 \
  --date "2025-10-02" \
  --force

# Expected output:
# 📍 Upserting meet location...
#   ✓ Geocoded "Forde, Norway": 61.4522, 5.8572
#   ✓ Created location for meet 661: Forde, Norway
```

## Geocoding Details

### Nominatim API Usage
- **Rate Limit**: 1 request per second (enforced by 1000ms delays)
- **Service**: OpenStreetMap Nominatim (free, no API key needed)
- **User-Agent**: "IWF-Database-Geocoder/1.0"
- **Error Handling**: Gracefully returns null coordinates on failure

### Example Geocoding Results
- "Forde, Norway" → 61.4522°N, 5.8572°E
- "Lima, Peru" → -12.0464°S, -77.0428°E
- "Jiangshan, China" → 28.1236°N, 119.0211°E

## Data Structure

### iwf_meet_locations Table
```sql
db_location_id      BIGSERIAL PRIMARY KEY
iwf_meet_id         TEXT NOT NULL UNIQUE (FK → iwf_meets.iwf_meet_id)
db_meet_id          BIGINT (optional, for reference)
city                TEXT
country             TEXT (full name, e.g., "Norway")
location_text       TEXT (formatted: "City, Country")
latitude            NUMERIC(10,8)
longitude           NUMERIC(11,8)
address             TEXT (currently NULL)
venue_name          TEXT (currently NULL)
date_range          TEXT (meet date from metadata)
created_at          TIMESTAMP
updated_at          TIMESTAMP (auto-updated on changes)
```

## Features

### ✅ Implemented
- Location extraction from event discovery data
- Country code → full name conversion (uses existing `mapCountryCodeToName()`)
- Nominatim geocoding with rate limiting
- Proper foreign key relationships
- Automatic timestamp management
- Graceful error handling

### 🔲 Future Enhancements
- Caching of geocoding results (to avoid re-requesting)
- Offline geocoding fallback
- Manual venue name/address enrichment UI
- Batch geocoding optimization
- Geographic clustering analysis

## Dependencies
- `@supabase/supabase-js`: Database access
- `node` built-in `fetch`: HTTP requests to Nominatim
- `scripts/production/iwf-lifter-manager.js`: `mapCountryCodeToName()` function

## Error Handling

All errors are handled gracefully:
- Missing location data → skips location upsert
- Geocoding failures → stores NULL coordinates, still creates location record
- Invalid country codes → uses code as-is (e.g., "ABC" stays as "ABC")
- Network errors → logs warning, continues without coordinates

## Performance Considerations

- Geocoding adds ~1 second per location due to rate limiting
- For bulk imports of N meets: expect ~N seconds additional time for geocoding
- Example: Importing 50 events → add ~50 seconds for geocoding
- Nominatim recommends requests be spaced by 1+ seconds to avoid IP blocking

## Testing

To verify implementation:

```javascript
// Check that locations were created
const { data } = await supabase
  .from('iwf_meet_locations')
  .select('*')
  .eq('iwf_meet_id', '661')
  .single();

console.log(data);
// Should show: {
//   iwf_meet_id: '661',
//   city: 'Forde',
//   country: 'Norway',
//   location_text: 'Forde, Norway',
//   latitude: 61.4522,
//   longitude: 5.8572,
//   ...
// }
```

## Migration Notes

The previous implementation had a schema mismatch:
- Old FK tried to reference `iwf_meets.db_meet_id` (wrong)
- New FK correctly references `iwf_meets.iwf_meet_id` (IWF event ID - semantic key)
- Code now passes `iwf_meet_id` to location functions (not `db_meet_id`)

This ensures proper relational integrity and enables correct join queries:
```sql
SELECT m.meet, l.location_text
FROM iwf_meets m
JOIN iwf_meet_locations l ON m.iwf_meet_id = l.iwf_meet_id
WHERE m.iwf_meet_id = '661';
```
