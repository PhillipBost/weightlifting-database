# IWF Database Schema Documentation

**Generated**: 2025-11-04T04:28:37.412Z
**Database**: IWF (fallback discovery)
**Discovery Method**: fallback

## Summary
- **Total tables discovered**: 3
- **Tables with data**: 3
- **Total rows across all tables**: 87723

## Table List
```
✅ iwf_lifters (17712 rows, 10 columns)
✅ iwf_meet_results (69488 rows, 41 columns)
✅ iwf_meets (523 rows, 11 columns)
```

## Detailed Table Schemas


### iwf_lifters

**Row Count**: 17712

**Columns** (10):
```
db_lifter_id, athlete_name, gender, birth_year, created_at, updated_at, country_code, country_name, iwf_lifter_id, iwf_athlete_url
```

**Sample Data (3 rows)**:
```json
[
  {
    "db_lifter_id": 41710,
    "athlete_name": "Halil MUTLU",
    "gender": "M",
    "birth_year": 1973,
    "created_at": "2025-11-01T21:50:49.942121",
    "updated_at": "2025-11-01T21:50:49.942121",
    "country_code": "TUR",
    "country_name": "Turkey",
    "iwf_lifter_id": 447,
    "iwf_athlete_url": "https://iwf.sport/weightlifting_/athletes-bios/?athlete=mutlu-halil-1973-07-14&id=447"
  },
  {
    "db_lifter_id": 41711,
    "athlete_name": "Shizhang LAN",
    "gender": "M",
    "birth_year": 1974,
    "created_at": "2025-11-01T21:50:50.578817",
    "updated_at": "2025-11-01T21:50:50.578817",
    "country_code": "CHN",
    "country_name": "China",
    "iwf_lifter_id": 5476,
    "iwf_athlete_url": "https://iwf.sport/weightlifting_/athletes-bios/?athlete=lan-shizhang-1974-02-09&id=5476"
  },
  {
    "db_lifter_id": 41712,
    "athlete_name": "William Trujillo VARGAS",
    "gender": "M",
    "birth_year": 1970,
    "created_at": "2025-11-01T21:50:51.169053",
    "updated_at": "2025-11-01T21:50:51.169053",
    "country_code": "CUB",
    "country_name": "Cuba",
    "iwf_lifter_id": 5108,
    "iwf_athlete_url": "https://iwf.sport/weightlifting_/athletes-bios/?athlete=vargas-william-trujillo-1970-09-17&id=5108"
  }
]
```

### iwf_meet_results

**Row Count**: 69488

**Columns** (41):
```
db_result_id, db_lifter_id, meet_name, date, age_category, weight_class, lifter_name, body_weight_kg, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total, snatch_successful_attempts, cj_successful_attempts, total_successful_attempts, best_snatch_ytd, best_cj_ytd, best_total_ytd, bounce_back_snatch_2, bounce_back_snatch_3, bounce_back_cj_2, bounce_back_cj_3, gender, birth_year, competition_age, competition_group, rank, qpoints, q_masters, q_youth, created_at, updated_at, manual_override, country_code, country_name, db_meet_id
```

**Sample Data (3 rows)**:
```json
[
  {
    "db_result_id": 143521,
    "db_lifter_id": 41710,
    "meet_name": "69th MEN's and 12th WOMEN's WORLD CHAMPIONSHIPS",
    "date": "Nov 10, 1998",
    "age_category": "Senior",
    "weight_class": "56 kg",
    "lifter_name": "Halil MUTLU",
    "body_weight_kg": "55.66",
    "snatch_lift_1": "130",
    "snatch_lift_2": "-135",
    "snatch_lift_3": "135",
    "best_snatch": "135",
    "cj_lift_1": "-160",
    "cj_lift_2": "160",
    "cj_lift_3": "-166",
    "best_cj": "160",
    "total": "295",
    "snatch_successful_attempts": 2,
    "cj_successful_attempts": 1,
    "total_successful_attempts": 3,
    "best_snatch_ytd": 135,
    "best_cj_ytd": 160,
    "best_total_ytd": 295,
    "bounce_back_snatch_2": null,
    "bounce_back_snatch_3": true,
    "bounce_back_cj_2": true,
    "bounce_back_cj_3": null,
    "gender": "M",
    "birth_year": 1973,
    "competition_age": 25,
    "competition_group": "A",
    "rank": 1,
    "qpoints": 509.842,
    "q_masters": null,
    "q_youth": null,
    "created_at": "2025-11-01T21:50:48.294",
    "updated_at": "2025-11-01T21:50:48.294",
    "manual_override": false,
    "country_code": "TUR",
    "country_name": "Turkey",
    "db_meet_id": 1165
  },
  {
    "db_result_id": 143522,
    "db_lifter_id": 41711,
    "meet_name": "69th MEN's and 12th WOMEN's WORLD CHAMPIONSHIPS",
    "date": "Nov 10, 1998",
    "age_category": "Senior",
    "weight_class": "56 kg",
    "lifter_name": "Shizhang LAN",
    "body_weight_kg": "55.85",
    "snatch_lift_1": "122.5",
    "snatch_lift_2": "127.5",
    "snatch_lift_3": "-130",
    "best_snatch": "127.5",
    "cj_lift_1": "155",
    "cj_lift_2": "160",
    "cj_lift_3": "-165",
    "best_cj": "160",
    "total": "287.5",
    "snatch_successful_attempts": 2,
    "cj_successful_attempts": 2,
    "total_successful_attempts": 4,
    "best_snatch_ytd": 128,
    "best_cj_ytd": 160,
    "best_total_ytd": 288,
    "bounce_back_snatch_2": null,
    "bounce_back_snatch_3": null,
    "bounce_back_cj_2": null,
    "bounce_back_cj_3": null,
    "gender": "M",
    "birth_year": 1974,
    "competition_age": 24,
    "competition_group": "A",
    "rank": 2,
    "qpoints": 494.868,
    "q_masters": null,
    "q_youth": null,
    "created_at": "2025-11-01T21:50:48.947",
    "updated_at": "2025-11-01T21:50:48.947",
    "manual_override": false,
    "country_code": "CHN",
    "country_name": "China",
    "db_meet_id": 1165
  },
  {
    "db_result_id": 143523,
    "db_lifter_id": 41712,
    "meet_name": "69th MEN's and 12th WOMEN's WORLD CHAMPIONSHIPS",
    "date": "Nov 10, 1998",
    "age_category": "Senior",
    "weight_class": "56 kg",
    "lifter_name": "William Trujillo VARGAS",
    "body_weight_kg": "55.94",
    "snatch_lift_1": "127.5",
    "snatch_lift_2": "-130",
    "snatch_lift_3": "-132.5",
    "best_snatch": "127.5",
    "cj_lift_1": "-157.5",
    "cj_lift_2": "157.5",
    "cj_lift_3": "-165",
    "best_cj": "157.5",
    "total": "285",
    "snatch_successful_attempts": 1,
    "cj_successful_attempts": 1,
    "total_successful_attempts": 2,
    "best_snatch_ytd": 128,
    "best_cj_ytd": 158,
    "best_total_ytd": 285,
    "bounce_back_snatch_2": null,
    "bounce_back_snatch_3": false,
    "bounce_back_cj_2": true,
    "bounce_back_cj_3": null,
    "gender": "M",
    "birth_year": 1970,
    "competition_age": 28,
    "competition_group": "A",
    "rank": 3,
    "qpoints": 489.632,
    "q_masters": null,
    "q_youth": null,
    "created_at": "2025-11-01T21:50:49.511",
    "updated_at": "2025-11-01T21:50:49.511",
    "manual_override": false,
    "country_code": "CUB",
    "country_name": "Cuba",
    "db_meet_id": 1165
  }
]
```

### iwf_meets

**Row Count**: 523

**Columns** (11):
```
iwf_meet_id, meet, level, date, results, url, batch_id, scraped_date, created_at, updated_at, db_meet_id
```

**Sample Data (3 rows)**:
```json
[
  {
    "iwf_meet_id": "89",
    "meet": "71st MEN's and 14th WOMEN's WORLD CHAMPIONSHIPS",
    "level": "International",
    "date": "Nov 04, 2001",
    "results": 267,
    "url": "https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_id=89",
    "batch_id": "event_discovery_2001",
    "scraped_date": "2025-11-01T23:34:17.589+00:00",
    "created_at": "2025-11-01T23:34:43.666+00:00",
    "updated_at": "2025-11-01T23:36:50.23411+00:00",
    "db_meet_id": 1175
  },
  {
    "iwf_meet_id": "146",
    "meet": "29th MEN's and 9th WOMEN's JUNIOR WORLD CHAMPIONSHIPS",
    "level": "International",
    "date": "Jun 01, 2003",
    "results": 229,
    "url": "https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_id=146",
    "batch_id": "event_discovery_2003",
    "scraped_date": "2025-11-02T00:10:13.332+00:00",
    "created_at": "2025-11-02T00:10:33.531+00:00",
    "updated_at": "2025-11-02T00:12:33.957958+00:00",
    "db_meet_id": 1183
  },
  {
    "iwf_meet_id": "79",
    "meet": "OLYMPIC TEST EVENT",
    "level": "International",
    "date": "Mar 25, 2000",
    "results": 48,
    "url": "https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_id=79",
    "batch_id": "event_discovery_2000",
    "scraped_date": "2025-11-01T23:23:25.983+00:00",
    "created_at": "2025-11-01T23:23:42.849+00:00",
    "updated_at": "2025-11-01T23:24:14.751937+00:00",
    "db_meet_id": 1174
  }
]
```

## Important Notes

- This schema was discovered automatically on 11/3/2025, 11:28:37 PM
- Compare with `lib/supabaseIWF.ts` to ensure TypeScript interfaces match actual database schema
- Critical discrepancy to check: Field names like `country` vs `country_name`
- All table names and column names are case-sensitive in Supabase
- Sample data is limited to first 5 rows; use queries to explore full dataset
