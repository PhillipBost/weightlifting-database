#!/usr/bin/env node

/**
 * PRODUCTION: USA Weightlifting (USAW) Specialty Clubs & University Programs Synchronizer
 * 
 * Fetches and synchronizes:
 * 1. BIPOC & LGBTQIA+ Clubs from https://www.usaweightlifting.org/club-wso/bipoc-lgbtqia-clubs
 * 2. Collegiate University Programs from https://www.usaweightlifting.org/navigation/clubs/university-programs
 * 
 * Enriches public.usaw_clubs and public.usaw_university_programs.
 *
 * VERBATIM-ONLY RULE (2026-09-28, as-written/as-found):
 * - public.usaw_clubs.community_designation is the sole source of truth, stored
 *   byte-verbatim from the source table column (casing, "owned" suffix, slashes
 *   preserved). Never normalized, never inferred.
 * - is_bipoc_owned / is_lgbtqia_owned are DEPRECATED: frozen, never written by
 *   this script. No token-to-flag mapping exists. Any such mapping
 *   ("Latina" implies BIPOC, bare "LGBTQIA+" implies owned) is editorializing
 *   and is prohibited.
 * - Matching is exact-normalized first, then token-overlap with city/state
 *   corroboration. Raw substring fallback (key.includes(lower)) is removed:
 *   it caused "Blaze Barbell" to enrich "Ablaze Barbell".
 * - Add-only + report. Never deletes or tombstones. Absent rows are logged
 *   with specialty_last_seen_at semantics via console diff, not cleared.
 * 
 * Usage:
 *   node scripts/production/sync-usaw-specialty-clubs.js              # Full live sync
 *   node scripts/production/sync-usaw-specialty-clubs.js --dry-run   # Preview changes without database mutation
 *   node scripts/production/sync-usaw-specialty-clubs.js --bipoc     # BIPOC & LGBTQIA+ clubs only
 *   node scripts/production/sync-usaw-specialty-clubs.js --university# University programs only
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
const ExcelJS = require('exceljs');
const minimist = require('minimist');

const BIPOC_PAGE_URL = 'https://www.usaweightlifting.org/club-wso/bipoc-lgbtqia-clubs';
const UNIVERSITY_PAGE_URL = 'https://www.usaweightlifting.org/navigation/clubs/university-programs';
const FALLBACK_EXCEL_URL = 'https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/bltd3ef79f17c289ddc/68407a11954d3b9a94942b69/2025_University_Programs.xlsx';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Normalize a club name for comparison WITHOUT altering the stored value.
 * Lowercases, strips punctuation, collapses whitespace, drops generic suffix
 * tokens (club, wlc, weightlifting, barbell kept except barbell-vs-barbells
 * plural is normalized). Used for matching only; DB and source strings stay verbatim.
 */
function normalizeClubName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/[\u00a0]/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(t => t && !['club', 'wlc', 'weightlifting', 'weight', 'lifting', 'team', 'the'].includes(t))
        .map(t => (t === 'barbells' ? 'barbell' : t))
        .join(' ');
}

function clubNameTokens(name) {
    return new Set(normalizeClubName(name).split(' ').filter(Boolean));
}

/**
 * Token-overlap score in [0,1]: |intersection| / max(|a|,|b|).
 * Guards against substring collisions: "blaze barbell" vs "ablaze barbell"
 * share only 1 of 2 tokens -> 0.5, below threshold.
 */
function tokenOverlap(a, b) {
    const ta = clubNameTokens(a);
    const tb = clubNameTokens(b);
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / Math.max(ta.size, tb.size);
}

/**
 * Resolve the header row to column indexes by header text. Returns null when
 * the table shape is unexpected so the caller can abort instead of parsing
 * fixed indexes blindly (the Brightside NULL root cause).
 */
function resolveBipocHeaderIndexes($, headerRow) {
    const cells = $(headerRow).find('td, th').map((_, el) => $(el).text().trim().toLowerCase()).get();
    const findIdx = (...needles) => cells.findIndex(c => needles.some(n => c.includes(n)));
    const idx = {
        club: findIdx('club name'),
        contact: findIdx('contact'),
        email: findIdx('email'),
        address: findIdx('address'),
        city: findIdx('city'),
        instagram: findIdx('instagram'),
        designation: findIdx('bipoc', 'lgbtqia')
    };
    if (idx.club < 0 || idx.designation < 0) return null;
    return idx;
}

/**
 * Match a source club name against the DB map.
 * Tier 1: exact lowercase. Tier 2: normalized-name equality.
 * Tier 3: token overlap >= 0.8 AND city/state corroboration when both sides
 * have location data. Raw substring matching is intentionally absent.
 */
function matchExistingClub(clubNameRaw, cityStateZipRaw, clubMap, addressByKey) {
    const lower = clubNameRaw.toLowerCase().trim();
    if (clubMap.has(lower)) return clubMap.get(lower);
    const norm = normalizeClubName(clubNameRaw);
    for (const [key, val] of clubMap.entries()) {
        if (normalizeClubName(key) === norm) return val;
    }
    const normTokens = clubNameTokens(clubNameRaw);
    let best = null;
    let bestScore = 0;
    for (const [key, val] of clubMap.entries()) {
        const score = tokenOverlap(clubNameRaw, key);
        if (score < 0.8) continue;
        // Require location corroboration when both sides carry location text.
        const dbAddr = (addressByKey.get(key) || '').toLowerCase();
        const srcLoc = (cityStateZipRaw || '').toLowerCase();
        if (dbAddr && srcLoc) {
            const stateMatch = srcLoc.match(/,\s*([a-z]{2})\b/);
            const stateOk = !stateMatch || dbAddr.includes(stateMatch[1]) || dbAddr.includes(srcLoc.split(',')[0].trim().slice(0, 8));
            const cityTok = srcLoc.split(',')[0].trim().split(/\s+/)[0];
            const cityOk = !cityTok || dbAddr.includes(cityTok);
            if (!stateOk && !cityOk) continue;
            // Extra guard: single-token-difference pairs (blaze vs ablaze) need city+state.
            if (normTokens.size <= 3 && !(stateOk && cityOk)) continue;
        }
        if (score > bestScore) {
            bestScore = score;
            best = val;
        }
    }
    return best;
}

function getEasternTimestamp() {
    const now = new Date();
    return now.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' EDT/EST';
}

function extractCellText(cellValue) {
    if (!cellValue) return null;
    if (typeof cellValue === 'string') return cellValue.trim();
    if (typeof cellValue === 'object') {
        if (cellValue.hyperlink) return cellValue.hyperlink.trim();
        if (cellValue.text) return String(cellValue.text).trim();
        if (cellValue.richText && Array.isArray(cellValue.richText)) {
            return cellValue.richText.map(t => t.text).join('').trim();
        }
    }
    return String(cellValue).trim();
}

/**
 * Fetch HTML text with browser-like headers
 */
async function fetchHtml(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
}

/**
 * Synchronize BIPOC & LGBTQIA+ Clubs
 */
async function syncBipocLgbtqiaClubs(supabase, dryRun) {
    console.log('\n======================================================');
    console.log('🌈 Synchronizing BIPOC & LGBTQIA+ Specialty Clubs');
    console.log('======================================================');
    console.log(`Timestamp: ${getEasternTimestamp()}`);
    console.log(`Source URL: ${BIPOC_PAGE_URL}`);

    const html = await fetchHtml(BIPOC_PAGE_URL);
    const $ = cheerio.load(html);
    const table = $('table').first();

    if (!table || table.length === 0) {
        throw new Error('No <table> element found on BIPOC page. Aborting: a missing table must never produce an empty diff.');
    }

    const rows = table.find('tr');
    console.log(`Found ${rows.length} total rows in BIPOC/LGBTQIA+ directory table.`);

    // Row-count assertion: fail loudly on shape change or render failure.
    // The 2026-09-25 local run saw ~36 data rows; live page holds 23 as of
    // 2026-09-28. A parse below 20 rows is a page/parse failure, never a
    // delisting event — abort instead of emitting an absent-report.
    const MIN_BIPOC_DATA_ROWS = 20;
    const bipocDataRowCount = rows.length - 1;
    if (bipocDataRowCount < MIN_BIPOC_DATA_ROWS) {
        throw new Error(`BIPOC table data-row count ${bipocDataRowCount} below minimum ${MIN_BIPOC_DATA_ROWS}. Aborting to avoid misparse-driven writes.`);
    }

    // Fetch existing usaw_clubs for normalization and matching
    const { data: dbClubs, error: dbErr } = await supabase
        .from('usaw_clubs')
        .select('club_name, email, address, state, instagram, contact_name, community_designation, is_bipoc_owned, is_lgbtqia_owned');

    if (dbErr) {
        throw new Error(`Failed to query usaw_clubs: ${dbErr.message}`);
    }

    const clubMap = new Map();
    const addressByKey = new Map();
    dbClubs.forEach(c => {
        clubMap.set(c.club_name.toLowerCase().trim(), c);
        addressByKey.set(c.club_name.toLowerCase().trim(), c.address || '');
    });

    let matchedCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const seenSourceNames = new Set();

    // Resolve header row by text; abort loudly instead of fixed-index parsing.
    const headerIdx = resolveBipocHeaderIndexes($, rows[0]);
    if (!headerIdx) {
        throw new Error('BIPOC table headers unrecognized (need Club Name + BIPOC/LGBTQIA+ columns). Aborting to avoid fixed-index misparse.');
    }
    const cell = (cols, i) => (i >= 0 && i < cols.length ? cols[i] : '');

    // Row 0 is header
    for (let i = 1; i < rows.length; i++) {
        const cols = $(rows[i]).find('td, th').map((_, el) => $(el).text().trim()).get();
        if (cols.length < 2 || !cell(cols, headerIdx.club)) continue;

        const clubNameRaw = cell(cols, headerIdx.club).replace(/\u00a0/g, ' ').trim();
        const contactRaw = cell(cols, headerIdx.contact).replace(/\u00a0/g, ' ').trim() || null;
        const emailRaw = cell(cols, headerIdx.email).replace(/\u00a0/g, ' ').trim() || null;
        const addressRaw = (headerIdx.address >= 0 ? cell(cols, headerIdx.address) : '').replace(/\u00a0/g, ' ').trim() || null;
        const cityStateZipRaw = (headerIdx.city >= 0 ? cell(cols, headerIdx.city) : '').replace(/\u00a0/g, ' ').trim() || null;
        const instagramRaw = (headerIdx.instagram >= 0 ? cell(cols, headerIdx.instagram) : '').replace(/\u00a0/g, ' ').trim() || null;
        // VERBATIM: byte-exact source string. Never normalized, never inferred.
        const designationRaw = cell(cols, headerIdx.designation).replace(/\u00a0/g, ' ').trim() || null;

        // NO token-to-flag mapping. Flags are deprecated and never written.
        // A row with an empty designation is a source/parse anomaly: log + skip,
        // never NULL-clobber or sticky-preserve (the Brightside failure mode).

        // Parse State from City, St, Zip if possible (e.g. "Lewisville,TX 75056" or "San Antonio, TX 78247")
        let extractedState = null;
        if (cityStateZipRaw) {
            const stateMatch = cityStateZipRaw.match(/,\s*([A-Za-z]{2})\b/);
            if (stateMatch) {
                extractedState = stateMatch[1].toUpperCase();
            }
        }

        // Full composite address
        let combinedAddress = addressRaw;
        if (cityStateZipRaw && combinedAddress) {
            combinedAddress = `${combinedAddress}, ${cityStateZipRaw}`;
        } else if (cityStateZipRaw) {
            combinedAddress = cityStateZipRaw;
        }

        // Match against existing club in usaw_clubs (hardened; no substrings).
        const existingClub = matchExistingClub(clubNameRaw, cityStateZipRaw, clubMap, addressByKey);

        if (!designationRaw) {
            skippedCount++;
            console.warn(`[BIPOC SKIP] "${clubNameRaw}" has empty designation — logging and skipping, no write.`);
            continue;
        }
        seenSourceNames.add(normalizeClubName(clubNameRaw));

        if (existingClub) {
            matchedCount++;
            const canonicalName = existingClub.club_name;
            // Verbatim-only update: overwrite with the exact source string when
            // it differs; clear nothing silently. Flags untouched (deprecated).
            const needsDesignationWrite = existingClub.community_designation !== designationRaw;
            // Fill-only-if-empty for identity-adjacent fields: a future false match
            // must never clobber a real contact (Ablaze/Jason Anderson, 2026-09-28).
            const updatePayload = {
                updated_at: new Date().toISOString()
            };
            if (!existingClub.contact_name && contactRaw) updatePayload.contact_name = contactRaw;
            if (!existingClub.instagram && instagramRaw) updatePayload.instagram = instagramRaw;
            if (needsDesignationWrite) updatePayload.community_designation = designationRaw;

            // Only fill address/email/state if currently empty in DB
            if (!existingClub.email && emailRaw) updatePayload.email = emailRaw;
            if (!existingClub.address && combinedAddress) updatePayload.address = combinedAddress;
            if (!existingClub.state && extractedState) updatePayload.state = extractedState;

            console.log(`[BIPOC MATCH] "${clubNameRaw}" -> DB: "${canonicalName}" | Designation: "${designationRaw}"${needsDesignationWrite ? ' (updated verbatim)' : ' (already verbatim)'}`);
            if (updatePayload.contact_name || updatePayload.instagram) {
                console.log(`[BIPOC CONTACT FILL] "${canonicalName}" | contact: ${updatePayload.contact_name ? `"${updatePayload.contact_name}"` : '(kept)'} | instagram: ${updatePayload.instagram ? `"${updatePayload.instagram}"` : '(kept)'}`);
            }

            if (!dryRun) {
                const { error: upErr } = await supabase
                    .from('usaw_clubs')
                    .update(updatePayload)
                    .eq('club_name', canonicalName);

                if (upErr) {
                    console.error(`❌ Failed to update club "${canonicalName}": ${upErr.message}`);
                } else {
                    updatedCount++;
                }
            }
        } else {
            // New club stub (verbatim designation; flags left at DEFAULT false — retired).
            insertedCount++;
            console.log(`[BIPOC NEW STUB] "${clubNameRaw}" | Address: "${combinedAddress}" | Designation: "${designationRaw}"`);

            if (!dryRun) {
                const newClubPayload = {
                    club_name: clubNameRaw,
                    contact_name: contactRaw,
                    email: emailRaw,
                    address: combinedAddress,
                    state: extractedState,
                    instagram: instagramRaw,
                    community_designation: designationRaw,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                const { error: insErr } = await supabase
                    .from('usaw_clubs')
                    .insert(newClubPayload);

                if (insErr) {
                    console.error(`❌ Failed to insert new club "${clubNameRaw}": ${insErr.message}`);
                }
            }
        }
    }

    console.log(`\nBIPOC & LGBTQIA+ Clubs Summary (verbatim-only):`);
    console.log(`- Matched & Enriched Existing: ${matchedCount}`);
    console.log(`- New Club Stubs Created: ${insertedCount}`);
    console.log(`- Skipped (empty designation, no write): ${skippedCount}`);
    console.log(`- Total Directory Entries Processed: ${rows.length - 1}`);

    // Add-only + report: log DB rows carrying a designation that were NOT seen
    // on the live page this run. Never cleared automatically. Keyed on
    // normalizeClubName (not raw lowercase) so canonical variants
    // (BARBARIAN BARBELL CLUB vs Barbarian Barbell) do not false-positive.
    const absentDesignated = dbClubs.filter(c => c.community_designation && !seenSourceNames.has(normalizeClubName(c.club_name)));
    if (absentDesignated.length > 0) {
        console.warn(`\n[ABSENT REPORT] ${absentDesignated.length} designated DB rows not seen on live page (no action taken):`);
        absentDesignated.forEach(c => console.warn(`  - "${c.club_name}" | "${c.community_designation}"`));
    }

    return { total: rows.length - 1, matched: matchedCount, inserted: insertedCount, skipped: skippedCount, absent: absentDesignated.length };
}

/**
 * Discover Contentstack Excel download URL from University Programs webpage
 */
async function discoverUniversityExcelUrl() {
    console.log(`Fetching university programs page to discover dynamic Excel download link...`);
    const html = await fetchHtml(UNIVERSITY_PAGE_URL);

    // Look for assets.contentstack.io xlsx links
    const match = html.match(/https:\/\/assets\.contentstack\.io\/v3\/assets\/[^"'\s<>]+\.xlsx/i);
    if (match && match[0]) {
        console.log(`✅ Discovered dynamic Excel asset URL: ${match[0]}`);
        return match[0];
    }

    console.warn(`⚠️ Could not dynamically extract Contentstack Excel link. Falling back to known asset URL: ${FALLBACK_EXCEL_URL}`);
    return FALLBACK_EXCEL_URL;
}

/**
 * Synchronize Collegiate University Programs
 */
async function syncUniversityPrograms(supabase, dryRun) {
    console.log('\n======================================================');
    console.log('🎓 Synchronizing Collegiate University Programs');
    console.log('======================================================');
    console.log(`Timestamp: ${getEasternTimestamp()}`);
    console.log(`Source URL: ${UNIVERSITY_PAGE_URL}`);

    const excelUrl = await discoverUniversityExcelUrl();
    const response = await fetch(excelUrl, {
        headers: { 'User-Agent': USER_AGENT }
    });

    if (!response.ok) {
        throw new Error(`Failed to download spreadsheet from ${excelUrl}: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet('Website Updates') || workbook.worksheets[0];
    if (!worksheet) {
        throw new Error('No worksheet found in downloaded Excel spreadsheet');
    }

    console.log(`Loaded worksheet "${worksheet.name}" with ${worksheet.rowCount} rows.`);

    // Pre-load usaw_clubs to resolve associated_usaw_club foreign key
    const { data: dbClubs, error: dbClubsErr } = await supabase
        .from('usaw_clubs')
        .select('club_name');

    if (dbClubsErr) {
        throw new Error(`Failed to fetch usaw_clubs: ${dbClubsErr.message}`);
    }

    const validClubMap = new Map();
    dbClubs.forEach(c => {
        validClubMap.set(c.club_name.toLowerCase().trim(), c.club_name);
    });

    let currentState = null;
    let totalPrograms = 0;
    let upsertedCount = 0;
    let newlyStubbedClubs = 0;

    for (let r = 2; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        const col1 = extractCellText(row.getCell(1).value);
        const col2 = extractCellText(row.getCell(2).value);
        const col3 = extractCellText(row.getCell(3).value);
        const col4 = extractCellText(row.getCell(4).value);
        const col5 = extractCellText(row.getCell(5).value);

        if (!col1 && !col2 && !col3) continue;

        // State section header: School column is set, but Location and Club are null
        if (col1 && !col2 && !col3) {
            currentState = col1.trim();
            continue;
        }

        // Data row representing a university program
        if (col1 && currentState) {
            totalPrograms++;
            const schoolName = col1;
            const city = col2 || null;
            const associatedClubRaw = col3 || null;
            const instagram = col4 || null;
            const websiteUrl = col5 || null;

            // Resolve associated club foreign key
            let canonicalAssociatedClub = null;
            if (associatedClubRaw) {
                const lowerClub = associatedClubRaw.toLowerCase().trim();
                if (validClubMap.has(lowerClub)) {
                    canonicalAssociatedClub = validClubMap.get(lowerClub);
                } else {
                    // Check partial match in existing usaw_clubs
                    for (const [key, canonical] of validClubMap.entries()) {
                        if (key.includes(lowerClub) || lowerClub.includes(key)) {
                            canonicalAssociatedClub = canonical;
                            break;
                        }
                    }

                    // If still no club exists, stub it into usaw_clubs so the foreign key is satisfied
                    if (!canonicalAssociatedClub) {
                        canonicalAssociatedClub = associatedClubRaw;
                        console.log(`[NEW CLUB STUB FOR PROGRAM] Stubbing "${canonicalAssociatedClub}" into usaw_clubs (State: ${currentState})`);
                        if (!dryRun) {
                            const { error: stubErr } = await supabase
                                .from('usaw_clubs')
                                .insert({
                                    club_name: canonicalAssociatedClub,
                                    state: currentState,
                                    created_at: new Date().toISOString(),
                                    updated_at: new Date().toISOString()
                                });
                            if (stubErr && !stubErr.message.includes('duplicate')) {
                                console.warn(`⚠️ Could not stub associated club "${canonicalAssociatedClub}": ${stubErr.message}`);
                                canonicalAssociatedClub = null; // Prevent FK violation
                            } else {
                                validClubMap.set(lowerClub, canonicalAssociatedClub);
                                newlyStubbedClubs++;
                            }
                        } else {
                            validClubMap.set(lowerClub, canonicalAssociatedClub);
                            newlyStubbedClubs++;
                        }
                    }
                }
            }

            const programRecord = {
                school_name: schoolName,
                state: currentState,
                city: city,
                associated_usaw_club: canonicalAssociatedClub,
                instagram: instagram,
                website_url: websiteUrl,
                source_sheet: worksheet.name,
                updated_at: new Date().toISOString()
            };

            console.log(`[PROGRAM] ${schoolName} (${currentState}) | Club: ${canonicalAssociatedClub || 'None'} | Web: ${websiteUrl ? 'Yes' : 'No'}`);

            if (!dryRun) {
                const { error: upsertErr } = await supabase
                    .from('usaw_university_programs')
                    .upsert(programRecord, { onConflict: 'school_name,state' });

                if (upsertErr) {
                    console.error(`❌ Error upserting program "${schoolName}": ${upsertErr.message}`);
                } else {
                    upsertedCount++;
                }
            }
        }
    }

    console.log(`\nUniversity Programs Summary:`);
    console.log(`- Total Collegiate Programs Processed: ${totalPrograms}`);
    console.log(`- Upserted into Database: ${dryRun ? '0 (Dry Run)' : upsertedCount}`);
    console.log(`- Newly Stubbed Associated Clubs in usaw_clubs: ${newlyStubbedClubs}`);

    return { total: totalPrograms, upserted: upsertedCount, stubbedClubs: newlyStubbedClubs };
}

/**
 * Main execution entry point
 */
async function main() {
    const args = minimist(process.argv.slice(2), {
        boolean: ['dry-run', 'bipoc', 'university', 'help'],
        alias: { d: 'dry-run', h: 'help', b: 'bipoc', u: 'university' }
    });

    if (args.help) {
        console.log(`
USAW Specialty Clubs & University Programs Synchronizer
======================================================
Options:
  --dry-run, -d      Preview changes without database mutations
  --bipoc, -b        Synchronize BIPOC & LGBTQIA+ clubs only
  --university, -u   Synchronize University programs only
  --help, -h         Show this help message
        `);
        process.exit(0);
    }

    const dryRun = !!args['dry-run'];
    const bipocOnly = !!args.bipoc;
    const universityOnly = !!args.university;

    console.log(`🚀 Starting USAW Specialty & University Synchronizer`);
    console.log(`Mode: ${dryRun ? '🔍 DRY RUN (Read-Only)' : '⚡ LIVE SYNC (Database Writes Enabled)'}`);
    console.log(`Execution Time: ${getEasternTimestamp()}`);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

    try {
        if (!universityOnly) {
            await syncBipocLgbtqiaClubs(supabase, dryRun);
        }
        if (!bipocOnly) {
            await syncUniversityPrograms(supabase, dryRun);
        }
        console.log(`\n✅ Synchronization finished successfully at ${getEasternTimestamp()}`);
    } catch (err) {
        console.error(`\n❌ Fatal Error during synchronization: ${err.message}`);
        if (err.stack) console.error(err.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    syncBipocLgbtqiaClubs,
    syncUniversityPrograms,
    discoverUniversityExcelUrl,
    normalizeClubName,
    clubNameTokens,
    tokenOverlap,
    resolveBipocHeaderIndexes,
    matchExistingClub
};
