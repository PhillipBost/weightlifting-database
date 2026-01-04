/**
 * Fix Name Changes Script
 * 
 * AUTOMATED MERGER for athletes who changed names (e.g. Marriage).
 * 
 * LOGIC:
 * 1. Find "Conflict Groups": Lifters sharing a Membership # but having DIFFERENT names.
 * 2. Visit Sport80 Profile (via internal_id) to find the "Active Name".
 * 3. SAFETY CHECK: Verify EVERY result in DB (for both IDs) matches a result in Sport80 history.
 * 4. MERGE: Reassign results from OldID -> NewID. 
 *    - If conflict (unique constraint), DELETE the OldID's result (assumed duplicate).
 * 5. CLEANUP: Delete OldID lifter.
 * 
 * USAGE:
 *   node scripts/maintenance/fix-name-changes.js [--limit=1] [--no-dry-run]
 */

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const _ = require('lodash'); // Useful for grouping
const minimist = require('minimist');

require('dotenv').config();

// ARGS
const args = minimist(process.argv.slice(2));
const DRY_RUN = args['dry-run'] !== false; // Default to TRUE (unless --no-dry-run passed)
const LIMIT = args.limit || 1;
const LOG_FILE = 'merger_log.csv';
const ERROR_FILE = 'merger_errors.csv';

// SETUP
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function main() {
    console.log(`\n🐊 FIX NAME CHANGES SCRIPT`);
    console.log(`=================================`);
    console.log(`🔒 DRY RUN: ${DRY_RUN} (Pass --no-dry-run to execute)`);
    console.log(`🎯 LIMIT:   ${LIMIT} group(s)\n`);

    // Init Logs
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, 'timestamp,group_member_num,action,details\n');
    if (!fs.existsSync(ERROR_FILE)) fs.writeFileSync(ERROR_FILE, 'timestamp,group_member_num,error_type,message\n');

    // 1. FETCH CANDIDATES (Conflict Groups)
    console.log('⏳ Finding Conflict Groups (Shared Membership #, Different Names)...');

    // We fetch all lifters with membership numbers. 
    // Optimization: In a huge DB we'd use a view, but for ~40k lifters, fetching ID/Name/MemNum is fine (~2MB).
    const { data: lifters, error } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, membership_number, internal_id')
        .not('membership_number', 'is', null);

    if (error) throw error;

    // Group by Membership Number
    const grouped = _.groupBy(lifters, 'membership_number');

    // Filter for Conflicts
    let conflictGroups = [];
    for (const [memNum, group] of Object.entries(grouped)) {
        const uniqueNames = _.uniq(group.map(l => l.athlete_name.trim().toLowerCase()));
        if (uniqueNames.length > 1) {
            // Must have at least one valid internal_id to verify
            if (group.some(l => l.internal_id)) {
                conflictGroups.push({
                    membership_number: memNum,
                    lifters: group
                });
            }
        }
    }

    console.log(`📋 Found ${conflictGroups.length} Conflict Groups.`);

    // Slice Limit
    const targets = conflictGroups.slice(0, LIMIT);
    console.log(`🚀 Processing first ${targets.length} groups...\n`);

    // 2. SCRAPE & VERIFY
    console.log('🔌 Launching Puppeteer...');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    console.log('   Puppeteer launched.');
    const page = await browser.newPage();
    // Block junk
    await page.setRequestInterception(true);
    page.on('request', r => ['image', 'font', 'stylesheet'].includes(r.resourceType()) ? r.abort() : r.continue());

    try {
        for (const [i, group] of targets.entries()) {
            console.log(`\n▶️ Processing group ${i + 1}/${targets.length}...`);
            await processGroup(group, page);
        }
    } catch (err) {
        console.error('🚨 Main Loop Error:', err);
    } finally {
        await browser.close();
        console.log(`\n🏁 Done.`);
    }
}

async function processGroup(group, page) {
    const memNum = group.membership_number;
    console.log(`\n🔍 Analyzing Group: Member #${memNum}`);
    console.log(`   Candidates: ${group.lifters.map(l => `${l.athlete_name} (${l.lifter_id})`).join(', ')}`);

    // A. IDENTIFY CORRECT NAME via Sport80
    // Pick an internal_id (prefer the one that looks most recent? Random is fine for now, they point to same profile).
    const probe = group.lifters.find(l => l.internal_id);
    if (!probe) {
        logError(memNum, 'NO_INTERNAL_ID', 'No internal_id available to verify this group.');
        return;
    }

    console.log(`   🌍 Visiting Sport80 Profile (Internal ID: ${probe.internal_id})...`);
    let scrapeData = null;
    try {
        scrapeData = await scrapeSport80History(page, probe.internal_id);
    } catch (err) {
        logError(memNum, 'SCRAPE_ERROR', err.message);
        return;
    }

    if (!scrapeData || !scrapeData.name) {
        logError(memNum, 'SCRAPE_FAILED', 'Could not extract active name from Sport80.');
        return;
    }

    const correctName = scrapeData.name;
    console.log(`   ✅ Active Name on Sport80: "${correctName}"`);

    // B. CLASSIFY LIFTERS
    // We normalize names for comparison
    const normCorrect = normalize(correctName);

    let keepLifter = null;
    let removeLifters = [];

    // Find the "Winner" (Matches active name) from our DB group
    // If multiple match active name, pick the one with internal_id or lowest ID.
    const matches = group.lifters.filter(l => normalize(l.athlete_name) === normCorrect);

    if (matches.length > 0) {
        // Pick best match. Prefer one with internal_id.
        keepLifter = matches.find(l => l.internal_id) || matches[0];
        // All others in group are to be removed
        removeLifters = group.lifters.filter(l => l.lifter_id !== keepLifter.lifter_id);
    } else {
        // NONE match the active name?
        // This is tricky. It means the "new" name isn't in our DB yet, or spelling is way off.
        // We probably shouldn't auto-merge if we don't have a clean destination.
        // OR we pick the one with the correct internal_id and RENAME it?
        // SAFE MODE: Log error and skip.
        logError(memNum, 'NO_MATCHING_DESTINATION', `DB has [${group.lifters.map(n => n.athlete_name).join(', ')}] but Sport80 is "${correctName}". No exact match to merge INTO.`);
        return;
    }

    console.log(`   🎯 KEEP: ${keepLifter.athlete_name} (ID: ${keepLifter.lifter_id})`);
    console.log(`   🗑️  MERGE/DELETE: ${removeLifters.map(l => `${l.athlete_name} (${l.lifter_id})`).join(', ')}`);

    // C. SAFETY CHECK: HISTORY VERIFICATION
    // Check ALL results for ALL lifters in group exist in scrapeData.history
    console.log(`   🛡️  Verifying Results Integrity...`);

    const allLifterIds = group.lifters.map(l => l.lifter_id);
    const { data: dbResults } = await supabase
        .from('usaw_meet_results')
        .select('date, total, meet_name, result_id')
        .in('lifter_id', allLifterIds);

    // We verify strict existence of (Date + Total) in scraped history.
    // Date might vary slightly (format), Total exact.
    // Sport80 history dates are usually 'MMM DD, YYYY'. DB is 'YYYY-MM-DD' or similar.
    // We need robust date parsing.

    const historySignatures = scrapeData.history.map(h => {
        const d = new Date(h.date);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${parseFloat(h.total)}`;
    });

    const missingResults = [];

    // Group DB results by signature first
    // If we have 2 DB rows (duplicates) and 1 Sport80 row, that is VALID (we are merging them).
    // Failing condition: A signature exists in DB but NOT in Sport80.
    const dbSignatures = new Set(dbResults.map(res => {
        const d = new Date(res.date);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${parseFloat(res.total)}`;
    }));

    for (const sig of dbSignatures) {
        // We only care if the signature is completely absent from Sport80
        if (!historySignatures.includes(sig)) {
            // Find one example result for logging
            const example = dbResults.find(r => {
                const d = new Date(r.date);
                return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${parseFloat(r.total)}` === sig;
            });

            // Ignore 0 totals as they often don't appear in rankings/history
            if (parseFloat(example.total) > 0) {
                missingResults.push(example);
            }
        }
    }

    if (missingResults.length > 0) {
        console.log(`      ⚠️  Found ${missingResults.length} signatures in DB not present in Sport80 History.`);
        missingResults.forEach(r => console.log(`          Missing: ${r.date} - ${r.meet_name} (Total: ${r.total})`));

        // Log error but maybe proceed if forced? No, stick to safety.
        logError(memNum, 'HISTORY_MISMATCH', `Safety check failed. ${missingResults.length} unique meet signatures found in DB but not in Sport80. Aborting merge.`);
        return;
    }

    console.log(`   ✅ Safety Check Passed. All ${dbResults.length} DB results validated in Sport80 history.`);

    // D. EXECUTE MERGE
    if (DRY_RUN) {
        console.log(`   [DRY RUN] Simulation for ${keepLifter.athlete_name} (ID: ${keepLifter.lifter_id}):`);

        // Fetch all potential conflicts first
        const { data: winnerResults } = await supabase
            .from('usaw_meet_results')
            .select('date, meet_name, total')
            .eq('lifter_id', keepLifter.lifter_id);

        const winnerSignatures = new Set(winnerResults.map(r => {
            const d = new Date(r.date);
            return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${parseFloat(r.total)}`;
        }));

        for (const loser of removeLifters) {
            console.log(`      Parsing loser ${loser.athlete_name} (${loser.lifter_id})...`);
            const { data: loserResults } = await supabase
                .from('usaw_meet_results')
                .select('result_id, date, meet_name, total')
                .eq('lifter_id', loser.lifter_id);

            for (const res of loserResults) {
                const d = new Date(res.date);
                const sig = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${parseFloat(res.total)}`;

                if (winnerSignatures.has(sig)) {
                    console.log(`         ♻️  DUPLICATE: ${res.date} - ${res.meet_name} (Total: ${res.total}) -> WOULD DELETE (Conflict with existing)`);
                } else {
                    console.log(`         ⚡ MOVE:      ${res.date} - ${res.meet_name} (Total: ${res.total}) -> WOULD UPDATE to lifter_id=${keepLifter.lifter_id}`);
                }
            }
            if (loserResults.length === 0) {
                console.log(`         (No results to move)`);
            }
            console.log(`      🗑️  WOULD DELETE lifter ${loser.lifter_id}`);
        }

        logAction(memNum, 'DRY_MERGE', `Would merge [${removeLifters.map(l => l.lifter_id)}] into ${keepLifter.lifter_id}`);
    } else {
        // REAL MERGE
        // Check if KeepLifter needs Internal ID (Scenario: Missing on keeper, present on loser)
        // We do this ONCE before processing losers.
        const donorWithId = removeLifters.find(l => l.internal_id);
        if (!keepLifter.internal_id && donorWithId) {
            console.log(`      💡 Transferring Internal ID ${donorWithId.internal_id} from ${donorWithId.athlete_name} to ${keepLifter.athlete_name}...`);
            const { error: idError } = await supabase
                .from('usaw_lifters')
                .update({ internal_id: donorWithId.internal_id })
                .eq('lifter_id', keepLifter.lifter_id);

            if (idError) {
                console.error(`      ❌ Error transferring internal_id: ${idError.message}`);
            } else {
                console.log(`      ✅ Internal ID transferred.`);
                keepLifter.internal_id = donorWithId.internal_id; // Update local obj
            }
        }

        for (const loser of removeLifters) {
            console.log(`      ⚡ Merging ${loser.athlete_name} (${loser.lifter_id}) -> ${keepLifter.athlete_name} (${keepLifter.lifter_id})...`);

            const { data: loserResults } = await supabase
                .from('usaw_meet_results')
                .select('result_id, meet_name')
                .eq('lifter_id', loser.lifter_id);

            for (const res of loserResults) {
                // Try Update (Move ID AND Update Name)
                const { error: moveError } = await supabase
                    .from('usaw_meet_results')
                    .update({
                        lifter_id: keepLifter.lifter_id,
                        lifter_name: keepLifter.athlete_name // Sync name!
                    })
                    .eq('result_id', res.result_id);

                if (moveError) {
                    if (moveError.message.includes('unique constraint')) {
                        console.log(`         ♻️ Constraint conflict on Result ${res.result_id}. Deleting duplicate.`);
                        await supabase.from('usaw_meet_results').delete().eq('result_id', res.result_id);
                    } else {
                        console.error(`         ❌ Error moving result: ${moveError.message}`);
                        logError(memNum, 'MOVE_ERROR', `Result ${res.result_id}: ${moveError.message}`);
                    }
                }
            }

            // Verify Loser is Empty
            const { count } = await supabase
                .from('usaw_meet_results')
                .select('*', { count: 'exact', head: true })
                .eq('lifter_id', loser.lifter_id);

            if (count === 0) {
                console.log(`      🗑️  Deleting empty lifter ${loser.lifter_id}`);
                await supabase.from('usaw_lifters').delete().eq('lifter_id', loser.lifter_id);
            } else {
                console.warn(`      ⚠️  Lifter ${loser.lifter_id} still has ${count} results. Keeping record.`);
                logError(memNum, 'INCOMPLETE_MERGE', `Lifter ${loser.lifter_id} not empty after merge.`);
            }
        }
        logAction(memNum, 'MERGED', `Merged [${removeLifters.map(l => l.lifter_id)}] into ${keepLifter.lifter_id}`);
    }
}

// HELPERS
// HELPERS
async function scrapeSport80History(page, internalId) {
    const url = `https://usaweightlifting.sport80.com/public/rankings/member/${internalId}`;

    // Set viewport to ensure content loads (desktop view)
    await page.setViewport({ width: 1400, height: 900 });

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

        // Wait for ANY title-like element
        try {
            await page.waitForFunction(() => {
                return document.title.includes('Results') ||
                    document.querySelector('.s80-toolbar-title') ||
                    document.querySelector('h1') ||
                    document.querySelector('.v-card__title h2');
            }, { timeout: 10000 });
        } catch (e) {
            console.log(`   ⚠️ Timeout waiting for title selectors, proceeding anyway...`);
        }

        // Get Name - Try multiple sources
        // Get Name - Try multiple sources based on verified console output
        const nameData = await page.evaluate(() => {
            const debug = {
                title: document.title,
                cardTitle: document.querySelector('.v-card__title')?.textContent,
                h2s: Array.from(document.querySelectorAll('h2')).map(h => h.textContent),
                toolbar: document.querySelector('.s80-toolbar-title')?.textContent
            };

            // 1. Document Title: "Natalie Stanghill Results | Sport:80"
            if (document.title && document.title.includes('Results | Sport:80')) {
                return { name: document.title.replace(' Results | Sport:80', '').trim() };
            }

            // 2. H2: "Natalie Stanghill Results"
            // We search for any h2 containing "Results"
            const h2s = Array.from(document.querySelectorAll('h2'));
            const resultH2 = h2s.find(h => h.textContent.includes('Results'));
            if (resultH2) {
                return { name: resultH2.textContent.replace(' Results', '').trim() };
            }

            // 3. Card Title: "Natalie Stanghill Results Back to Rankings"
            const cardTitle = document.querySelector('.v-card__title');
            if (cardTitle) {
                let text = cardTitle.textContent.trim();
                text = text.replace(' Back to Rankings', '').replace(' Results', '').trim();
                return { name: text };
            }

            // 4. Toolbar: "Natalie Stanghill Results"
            const toolbar = document.querySelector('.s80-toolbar-title');
            if (toolbar) {
                return { name: toolbar.textContent.replace(' Results', '').trim() };
            }

            return { name: null, debug };
        });

        if (!nameData.name) {
            console.log(`   ❌ Name Extraction Failed. Debug:`, nameData.debug);
            return { name: null, history: [] };
        }

        const name = nameData.name;

        // Get History Table with Pagination
        let history = [];
        let hasMorePages = true;
        let pageNum = 1;

        console.log(`   📄 Scraping history...`);

        while (hasMorePages && pageNum <= 10) { // Safety limit
            // Scrape current page rows
            const pageRows = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tr'));
                return rows.map(r => {
                    const cols = r.querySelectorAll('td');
                    if (cols.length < 3) return null;
                    // Columns often: Date, Meet, Type, Category, Bodyweight, Total
                    // But Sport80 columns vary. User script had:
                    // meet_name: cols[0], date: cols[1], total: last?
                    // Let's stick to the previous logic but apply robustly
                    return {
                        meet_name: cols[0]?.textContent?.trim(),
                        date: cols[1]?.textContent?.trim(),
                        total: cols[cols.length - 1]?.textContent?.trim()
                    };
                }).filter(r => r && r.date && r.total && r.date !== 'Date'); // Filter headers
            });

            if (pageRows.length > 0) {
                history = history.concat(pageRows);
            }

            // Check for Next Page
            const nextButton = await page.$('.v-data-footer__icons-after .v-btn:not([disabled])');

            if (nextButton) {
                await nextButton.click();
                await new Promise(resolve => setTimeout(resolve, 3000)); // Simple wait for Vue update
                pageNum++;
            } else {
                hasMorePages = false;
            }
        }
        console.log(`      ✅ Total items scraped: ${history.length}`);

        return { name, history };

    } catch (err) {
        console.log(`   🚨 Scraper Error: ${err.message}`);
        return { name: null, history: [] };
    }
}

function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function logError(memNum, type, msg) {
    fs.appendFileSync(ERROR_FILE, `${new Date().toISOString()},${memNum},${type},"${msg.replace(/"/g, '""')}"\n`);
    console.log(`   ❌ ERROR: ${msg}`);
}

function logAction(memNum, action, details) {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()},${memNum},${action},"${details.replace(/"/g, '""')}"\n`);
}

main().catch(console.error);
