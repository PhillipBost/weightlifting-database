# Root Cause Analysis: Phantom Duplicate Records

**Investigation Date:** 2025-11-01
**Scope:** 19,052 duplicate performance records across 8,800 groups
**Impact:** Estimated 10% of all IWF competition results are phantom records

## Executive Summary

The database contains massive-scale systematic data corruption where complete competition results from one event have been duplicated and incorrectly assigned to completely different events. This is NOT legitimate same-athlete duplicates, but phantom records that do not represent actual competition results.

**Critical Finding:** Many meet pairs are chronologically impossible (e.g., results paired between events that are years apart, sometimes with dates going backwards).

## Evidence of Systematic Corruption

### Scale
- **19,052 total duplicate records** from real competitions
- **7,529 duplicate pairs** (2 copies of same performance)
- **1,130 triplicates** (3 copies)
- **102 groups with 4+ copies**
- **1 group with 6 copies** (highly suspicious)

### Top Problematic Meet Pairs (by frequency)

| Rank | Meet ID Pair | Frequency | Meet 1 | Meet 2 | Time Gap |
|------|--------------|-----------|--------|--------|----------|
| 1 | 671 ↔ 672 | 240 groups | 2nd UNIVERSITY WORLD CUP (May 1999) | 31st JUNIOR WORLD CHAMPS (May 2005) | 6 years forward |
| 2 | 785 ↔ 788 | 202 groups | PACIFIC GAMES (Sep 2011) | YOUTH OLYMPIC QUAL (May 2010) | 1 year BACKWARD |
| 3 | 1089 ↔ 1090 | 190 groups | Tokyo Test Event (Jul 2019) | European Youth Champs (Aug 2022) | 3 years forward |
| 4 | 1019 ↔ 1020 | 170 groups | Pan-American Champs (Nov 2021) | 2025 JUNIOR WORLD CHAMPS (Apr 2025) | 3+ years forward |
| 5 | 864 ↔ 865 | 160 groups | AFRICAN CHAMPS (Mar 2012) | EUROPEAN YOUTH CHAMPS (Sep 2016) | 4 years forward |
| 6 | 652 ↔ 653 | 155 groups | 73rd WORLD CHAMPS (Nov 2003) | XXVIII OLYMPICS (Aug 2004) | 1 year backward |
| 7 | 733 ↔ 734 | 142 groups | AFRICAN YOUTH CHAMPS (Oct 2013) | YOUTH WORLD CHAMPS (Sep 2012) | 1 year BACKWARD |

### Why This Cannot Be Legitimate Data

1. **Chronological Impossibilities:**
   - Meet pair 785 ↔ 788: PACIFIC GAMES results duplicated to a 2010 event they occurred in 2011
   - Meet pair 652 ↔ 653: 2003 World Championships data appearing in 2004 Olympics
   - Meet pair 733 ↔ 734: 2013 data paired with 2012 event (impossible)

2. **Perfect Duplicates Across Different Events:**
   - Identical performance data (all lifts, totals, rankings) copied verbatim
   - Not the same athlete competing in the same event multiple times
   - Same `created_at` timestamps on different db_result_ids (import artifacts)

3. **Cross-Continental Meet Pairs:**
   - Pacific Games results paired with European championships
   - African championships paired with European youth events
   - Pan-American events paired with Asian/European events
   - **Same athletes cannot compete in geographically impossible events simultaneously**

## Root Causes

### Primary Hypothesis: Broken Event Import Merge

Evidence suggests an import process that:

1. **Retrieves event data from IWF.sport** with correct event_id
2. **Duplicates the entire result set** during processing
3. **Assigns duplicates to wrong event_ids** - possibly from:
   - Batch processing loop that processes same event ID twice
   - File processing that reads same CSV twice but assigns different event_ids
   - Database upsert logic that creates duplicates due to key collision
4. **Results in phantom records** with:
   - Same performance data as legitimate records
   - Wrong db_meet_id assignment
   - Different db_result_id (new row created)
   - Chronologically impossible meet combinations

### Secondary Hypothesis: Scraper De-duplication Failure

Alternative possibility:
- Scraper retrieves results correctly
- Deduplication logic fails (e.g., matching on wrong fields)
- Creates duplicate records when trying to prevent duplicates
- Assigns to wrong events during conflict resolution

## Data Quality Impact

**Affected Records:** ~10% of database
**Affected Events:** 240+ different events
**Affected Athletes:** Every athlete in corrupted events
**Analytics Impact:** CRITICAL
- Athlete performance statistics are inflated by duplicate records
- Event result counts are wrong
- Rankings and standings are corrupted
- Year-to-date calculations include phantom results

## Recommended Actions

### Immediate (Phase 1)
1. Delete all identified phantom records (19,052 rows)
2. Query to identify any remaining undetected duplicates using stricter criteria
3. Backup corrupted data for forensic analysis

### Short-term (Phase 2)
1. Identify which import batches/scraper runs created phantoms
2. Review import logs for batch_id patterns
3. Determine which import versions are broken

### Medium-term (Phase 3)
1. Implement validation in import process to prevent:
   - Duplicate imports of same event data
   - Cross-event assignment of results
   - Chronologically impossible meet combinations
2. Add integrity checks before db_result insertion
3. Require event_id validation against IWF.sport

### Long-term (Phase 4)
1. Implement referential integrity constraints
2. Add duplicate detection in pre-import validation
3. Audit trail for data modifications
4. Regular integrity scans (monthly)

## Next Steps

Before deleting phantom records:
1. Export complete list with context (athlete, event, dates)
2. Verify against IWF.sport manually for sample records
3. Create immutable backup
4. Document deletion process
5. Calculate data recovery impact
