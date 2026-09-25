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
        console.warn('⚠️ No <table> element found on BIPOC page.');
        return { total: 0, matched: 0, inserted: 0 };
    }

    const rows = table.find('tr');
    console.log(`Found ${rows.length} total rows in BIPOC/LGBTQIA+ directory table.`);

    // Fetch existing usaw_clubs for normalization and matching
    const { data: dbClubs, error: dbErr } = await supabase
        .from('usaw_clubs')
        .select('club_name, email, address, state, instagram, contact_name, community_designation, is_bipoc_owned, is_lgbtqia_owned');

    if (dbErr) {
        throw new Error(`Failed to query usaw_clubs: ${dbErr.message}`);
    }

    const clubMap = new Map();
    dbClubs.forEach(c => {
        clubMap.set(c.club_name.toLowerCase().trim(), c);
    });

    let matchedCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;

    // Row 0 is header
    for (let i = 1; i < rows.length; i++) {
        const cols = $(rows[i]).find('td, th').map((_, el) => $(el).text().trim()).get();
        if (cols.length < 2 || !cols[0]) continue;

        const clubNameRaw = cols[0].replace(/\u00a0/g, ' ').trim();
        const contactRaw = (cols[1] || '').replace(/\u00a0/g, ' ').trim() || null;
        const emailRaw = (cols[2] || '').replace(/\u00a0/g, ' ').trim() || null;
        const addressRaw = (cols[3] || '').replace(/\u00a0/g, ' ').trim() || null;
        const cityStateZipRaw = (cols[4] || '').replace(/\u00a0/g, ' ').trim() || null;
        const instagramRaw = (cols[5] || '').replace(/\u00a0/g, ' ').trim() || null;
        const designationRaw = (cols[6] || '').replace(/\u00a0/g, ' ').trim() || null;

        // Classify community tags
        const lowerDesig = (designationRaw || '').toLowerCase();
        const isBipoc = /black|brown|latina|latino|bipoc|asian/i.test(lowerDesig);
        const isLgbtqia = /lgbtqia|lgbt/i.test(lowerDesig);

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

        // Match against existing club in usaw_clubs
        let existingClub = clubMap.get(clubNameRaw.toLowerCase());
        
        // Secondary fuzzy match (e.g. "Barbarian Barbell" -> "BARBARIAN BARBELL CLUB")
        if (!existingClub) {
            for (const [key, val] of clubMap.entries()) {
                if (key.includes(clubNameRaw.toLowerCase()) || clubNameRaw.toLowerCase().includes(key)) {
                    existingClub = val;
                    break;
                }
            }
        }

        if (existingClub) {
            matchedCount++;
            const canonicalName = existingClub.club_name;
            const updatePayload = {
                contact_name: contactRaw || existingClub.contact_name,
                instagram: instagramRaw || existingClub.instagram,
                community_designation: designationRaw || existingClub.community_designation,
                is_bipoc_owned: isBipoc || existingClub.is_bipoc_owned,
                is_lgbtqia_owned: isLgbtqia || existingClub.is_lgbtqia_owned,
                updated_at: new Date().toISOString()
            };

            // Only fill address/email/state if currently empty in DB
            if (!existingClub.email && emailRaw) updatePayload.email = emailRaw;
            if (!existingClub.address && combinedAddress) updatePayload.address = combinedAddress;
            if (!existingClub.state && extractedState) updatePayload.state = extractedState;

            console.log(`[BIPOC MATCH] "${clubNameRaw}" -> DB: "${canonicalName}" | Tags: BIPOC=${isBipoc}, LGBTQIA=${isLgbtqia}`);

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
            // New club stub
            insertedCount++;
            console.log(`[BIPOC NEW STUB] "${clubNameRaw}" | Address: "${combinedAddress}" | Tags: BIPOC=${isBipoc}, LGBTQIA=${isLgbtqia}`);

            if (!dryRun) {
                const newClubPayload = {
                    club_name: clubNameRaw,
                    contact_name: contactRaw,
                    email: emailRaw,
                    address: combinedAddress,
                    state: extractedState,
                    instagram: instagramRaw,
                    community_designation: designationRaw,
                    is_bipoc_owned: isBipoc,
                    is_lgbtqia_owned: isLgbtqia,
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

    console.log(`\nBIPOC & LGBTQIA+ Clubs Summary:`);
    console.log(`- Matched & Enriched Existing: ${matchedCount}`);
    console.log(`- New Club Stubs Created: ${insertedCount}`);
    console.log(`- Total Directory Entries Processed: ${rows.length - 1}`);

    return { total: rows.length - 1, matched: matchedCount, inserted: insertedCount };
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
    discoverUniversityExcelUrl
};
