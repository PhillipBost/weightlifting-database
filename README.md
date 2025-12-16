# USAW Database Fields & Processes Matrix

> **[View Full Schema Documentation (SCHEMA.md)](SCHEMA.md)**


## All Processes

| Code | Process/File | Trigger | Status | Description |
|------|-------------|---------|--------|-------------|
| **DAILY** | `daily-scrape.yml` | Daily 2AM EST | ✅ Active | GitHub Action: Runs D1→D2→D3→D4 |
| &nbsp;&nbsp;&nbsp;&nbsp;D1 | `meet_scraper_2025.js` | Called by daily-scrape.yml | ✅ Active | Daily meet metadata scraping |
| &nbsp;&nbsp;&nbsp;&nbsp;D2 | `database-importer.js` + `scrapeOneMeet.js` | Called by daily-scrape.yml | ✅ Active | Meet data import + individual results scraping |
| &nbsp;&nbsp;&nbsp;&nbsp;D3 | `nightly-division-scraper.js` | Called by daily-scrape.yml | ✅ Active | Division-based athlete scraping (recent 2 months) |
| &nbsp;&nbsp;&nbsp;&nbsp;D4 | `athlete-csv-uploader.js` | Called by D3 automatically | ✅ Active | Athlete data upload & lifter table updates |
| **MONDAY** | `division-scraper-monday.yml` | Monday (time?) | ✅ Active | GitHub Action: Divisions 1-35 |
| &nbsp;&nbsp;&nbsp;&nbsp;M1 | `nightly-division-scraper.js` | Called by division-scraper-monday.yml | ✅ Active | Monday batch (divisions 1-35) |
| &nbsp;&nbsp;&nbsp;&nbsp;M2 | `athlete-csv-uploader.js` | Called by M1 automatically | ✅ Active | Upload Monday batch |
| **TUESDAY** | `division-scraper-tuesday.yml` | Tuesday (time?) | ✅ Active | GitHub Action: Divisions 36-70 |
| &nbsp;&nbsp;&nbsp;&nbsp;T1 | `nightly-division-scraper.js` | Called by division-scraper-tuesday.yml | ✅ Active | Tuesday batch (divisions 36-70) |
| &nbsp;&nbsp;&nbsp;&nbsp;T2 | `athlete-csv-uploader.js` | Called by T1 automatically | ✅ Active | Upload Tuesday batch |
| **WEDNESDAY** | `division-scraper-wednesday.yml` | Wednesday (time?) | ✅ Active | GitHub Action: Divisions 71-106 |
| &nbsp;&nbsp;&nbsp;&nbsp;W1 | `nightly-division-scraper.js` | Called by division-scraper-wednesday.yml | ✅ Active | Wednesday batch (divisions 71-106) |
| &nbsp;&nbsp;&nbsp;&nbsp;W2 | `athlete-csv-uploader.js` | Called by W1 automatically | ✅ Active | Upload Wednesday batch |
| **THURSDAY** | `division-scraper-thursday.yml` | Thursday (time?) | ✅ Active | GitHub Action: Divisions 107-141 |
| &nbsp;&nbsp;&nbsp;&nbsp;Th1 | `nightly-division-scraper.js` | Called by division-scraper-thursday.yml | ✅ Active | Thursday batch (divisions 107-141) |
| &nbsp;&nbsp;&nbsp;&nbsp;Th2 | `athlete-csv-uploader.js` | Called by Th1 automatically | ✅ Active | Upload Thursday batch |
| **FRIDAY** | `division-scraper-friday.yml` | Friday (time?) | ✅ Active | GitHub Action: Divisions 142-177 |
| &nbsp;&nbsp;&nbsp;&nbsp;F1 | `nightly-division-scraper.js` | Called by division-scraper-friday.yml | ✅ Active | Friday batch (divisions 142-177) |
| &nbsp;&nbsp;&nbsp;&nbsp;F2 | `athlete-csv-uploader.js` | Called by F1 automatically | ✅ Active | Upload Friday batch |
| **SATURDAY** | `division-scraper-saturday.yml` | Saturday (time?) | ✅ Active | GitHub Action: Divisions 178-213 |
| &nbsp;&nbsp;&nbsp;&nbsp;S1 | `nightly-division-scraper.js` | Called by division-scraper-saturday.yml | ✅ Active | Saturday batch (divisions 178-213) |
| &nbsp;&nbsp;&nbsp;&nbsp;S2 | `athlete-csv-uploader.js` | Called by S1 automatically | ✅ Active | Upload Saturday batch |
| **SUNDAY** | `division-scraper-sunday.yml` | Sunday (time?) | ✅ Active | GitHub Action: Divisions 214-248 |
| &nbsp;&nbsp;&nbsp;&nbsp;Su1 | `nightly-division-scraper.js` | Called by division-scraper-sunday.yml | ✅ Active | Sunday batch (divisions 214-248) |
| &nbsp;&nbsp;&nbsp;&nbsp;Su2 | `athlete-csv-uploader.js` | Called by Su1 automatically | ✅ Active | Upload Sunday batch |
| **DEACTIVATED** | Internal ID GitHub Action | Was daily, now off | ❌ Deactivated | GitHub Action for internal ID system |
| &nbsp;&nbsp;&nbsp;&nbsp;ID1 | `internal-id-scraper.js` | Manual/Deactivated | ❌ Deactivated | Internal ID scraping |
| &nbsp;&nbsp;&nbsp;&nbsp;ID2 | `internal-id-uploader.js` | Manual/Deactivated | ❌ Deactivated | Internal ID upload |
| **MANUAL** | `athlete-disambiguation.js` | Manual | ⚪ Manual | Athlete disambiguation system |

## Database Field Coverage

### meets Table - Daily Meet Process (D1)
| Field Name | Type | Status | Notes |
|------------|------|--------|-------|
| meet_id | int (PK) | ✓ Populated | Unique identifier from USAW URLs |
| Meet | text | ✓ Populated | Meet name/title |
| Level | text | ✓ Populated | Competition level |
| Date | text | ✓ Populated | Meet date as scraped |
| Results | text | ✓ Populated | Results availability status |
| URL | text | ✓ Populated | Direct URL to meet results |
| batch_id | text | ✓ Populated | Processing batch identifier |
| scraped_date | timestamp | ✓ Populated | When meet was first scraped |

### lifters Table - Multiple Processes
| Field Name | Type | D2 | Division Scrapers | Uploaders | ID System | Notes |
|------------|------|----|--------------------|-----------|-----------|-------|
| lifter_id | int (PK) | ✓ | | ✓ | | Auto-increment, created when first encountered |
| athlete_name | text | ✓ | | ✓ | | From meet results or division data |
| membership_number | int | | | ✓ | | USAW membership number |
| gender | text | | | ✓ | | From division data |
| club_name | text | | | ✓ | | Current club affiliation |
| wso | text | | | ✓ | | Weightlifting State Organization |
| birth_year | int | | | ✓ | | From division data |
| national_rank | int | | | ✓ | | Current national ranking |
| internal_id | int | | ✓ | ❌ | ✓ | **CRITICAL GAP: Scraped but not uploaded** |
| internal_id_2 | int | | | | ✓ | For contaminated athletes |
| internal_id_3 | int | | | | ✓ | For contaminated athletes |
| internal_id_4 | int | | | | ✓ | For contaminated athletes |
| internal_id_5 | int | | | | ✓ | For contaminated athletes |
| created_at | timestamp | ✓ | | ✓ | | Automatic timestamps |
| updated_at | timestamp | ✓ | | ✓ | | Automatic timestamps |

### meet_results Table - Meet Data Import (D2)
| Field Name | Type | Status | Notes |
|------------|------|--------|-------|
| result_id | int (PK) | ✓ Populated | Auto-increment |
| meet_id | int (FK) | ✓ Populated | References meets.meet_id |
| lifter_id | int (FK) | ✓ Populated | References lifters.lifter_id |
| meet_name | text | ✓ Populated | Meet name from results |
| date | text | ✓ Populated | Meet date from results |
| age_category | text | ✓ Populated | Age category |
| weight_class | text | ✓ Populated | Weight class |
| lifter_name | text | ✓ Populated | Name as appeared at competition |
| body_weight_kg | text | ✓ Populated | Competition bodyweight |
| snatch_lift_1 | text | ✓ Populated | First snatch attempt |
| snatch_lift_2 | text | ✓ Populated | Second snatch attempt |
| snatch_lift_3 | text | ✓ Populated | Third snatch attempt |
| best_snatch | text | ✓ Populated | Best successful snatch |
| cj_lift_1 | text | ✓ Populated | First clean & jerk attempt |
| cj_lift_2 | text | ✓ Populated | Second clean & jerk attempt |
| cj_lift_3 | text | ✓ Populated | Third clean & jerk attempt |
| best_cj | text | ✓ Populated | Best successful clean & jerk |
| total | text | ✓ Populated | Competition total |
| wso | text | ✓ Updated by Uploaders | WSO at time of competition |
| club_name | text | ✓ Updated by Uploaders | Club at time of competition |

**Legend:**
- ✓ = Process populates this field
- ❌ = Process scrapes data but doesn't upload to database  
- ⚪ = Manual process

**Process Groups:**
- **Daily Meet Process**: D1 (meet_scraper_2025.js) → D2 (database-importer.js + scrapeOneMeet.js)
- **Division Scrapers**: D3 + M1 + T1 + W1 + Th1 + F1 + S1 + Su1 (all use nightly-division-scraper.js)
- **Uploader Process**: D4 + M2 + T2 + W2 + Th2 + F2 + S2 + Su2 (all use athlete-csv-uploader.js)
- **Internal ID System**: ID1 + ID2 - DEACTIVATED
