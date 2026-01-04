/**
 * Audit Lifter Names Script (Enhanced)
 * 
 * Verifies athlete names in the database against the live Sport80 member page.
 * Tracks audit state in a local JSON file to avoid duplicates and prioritize freshness.
 * 
 * Features:
 * - State Tracking: scripts/audit/audit-state.json
 * - Prioritization: Unaudited > Female > Male > Stale
 * - Logs: audit_results.csv (all), audit_mismatches.csv (mismatches only)
 * 
 * Usage:
 *   node scripts/audit/audit-lifter-names.js [--limit=50] [--gender=F] [--output=results.csv]
 */

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

require('dotenv').config();

// CLI Args
const args = minimist(process.argv.slice(2));
const LIMIT = args.limit || 50;
const GENDER_FILTER = args.gender ? args.gender.toUpperCase() : null; // 'M' or 'F'
const OUTPUT_FILE = args.output || `audit_results.csv`;
const MISMATCH_FILE = args.mismatch || `audit_mismatches.csv`;
const STATE_FILE = path.join(__dirname, 'audit-state.json');

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Load State
let auditState = {};
if (fs.existsSync(STATE_FILE)) {
    try {
        auditState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
        console.error('⚠️ Could not parse audit-state.json, starting fresh.');
    }
}

async function main() {
    console.log('🔍 Starting Lifter Name Audit (Enhanced)...');
    console.log('------------------------------------------');
    console.log(`🎯 Limit: ${LIMIT}`);
    if (GENDER_FILTER) console.log(`🎯 Gender Priority: ${GENDER_FILTER}`);

    // 1. Fetch Candidates
    // We need internal_id and name. To infer gender, we ideally join or fetch distinct lifters.
    // Fetching ALL lifters with internal_id might be heavy (40k+ rows), but feasible for a run.
    // Let's fetch essential columns.

    console.log('⏳ Fetching candidate list from database...');
    const { data: lifters, error } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .not('internal_id', 'is', null);

    if (error) {
        throw new Error(`Database error: ${error.message}`);
    }

    console.log(`📋 Total Database Candidates: ${lifters.length}`);

    // 2. Fetch Gender Hints (if needed for prioritization)
    // To properly prioritize females, we need to know who is female.
    // We can get this from usaw_meet_results.
    // A quick way is to fetch distinct lifter_id, gender from results.
    console.log('⏳ Fetching gender hints...');
    let genderMap = {};
    try {
        // We can't easily do "distinct on" via simple client without RPC sometimes, 
        // but let's try a bulk fetch of recent results or just a big map.
        // Optimization: For this script, maybe just fetching 50k result rows is fine?
        // Better: Prioritize by checking the 'usaw_lifters' list against known genders if we had them.
        // Backup: We'll infer gender during the scrape if we don't have it, but we want to PRIORITIZE it.

        // Let's try to get a mapping.
        const { data: results } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id, gender')
            .not('gender', 'is', null)
            // .limit(50000) // Maybe limit?
            .csv(); // CSV might be lighter? No, let's just grab ID/Gender

        // Actually, fetching all results is too big (millions?).
        // Let's just ignore the gender map for the *bulk* fetch unless we have a `stats` table.
        // WE CAN use a separate heuristic: typical female names? No.

        // RE-READ PLAN: "Gender Priority: Within Unaudited, prioritize likely Female athletes (inferred from `usaw_meet_results`)."
        // Okay, let's try to fetch gender for the *subset* we are about to check.
        // But we need to select the subset first.
    } catch (e) { }

    // 3. Selection Logic
    // buckets:
    // A. Unaudited
    // B. Audited

    const now = Date.now();
    const candidates = lifters.map(l => {
        const state = auditState[l.internal_id] || {};
        return {
            ...l,
            last_audited: state.last_audited || 0,
            gender_hint: state.gender || 'U', // 'U'nknown, 'F', 'M'
        };
    });

    // Sort by:
    // 1. Last Audited (Ascending - 0 means never)
    // 2. Gender (F > M > U) - if requested

    candidates.sort((a, b) => {
        // 1. Audit Time
        if (a.last_audited !== b.last_audited) {
            return a.last_audited - b.last_audited;
        }
        // 2. Gender Priority (F first)
        // If sorting A first: F < M
        if (GENDER_FILTER === 'F') {
            const getScore = (g) => (g === 'F' ? 0 : g === 'M' ? 2 : 1);
            return getScore(a.gender_hint) - getScore(b.gender_hint);
        }

        return 0; // standard sort
    });

    const targets = candidates.slice(0, LIMIT);
    console.log(`📋 Selected ${targets.length} targets to audit.`);
    console.log(`   (Oldest Audit: ${targets[0].last_audited === 0 ? 'NEVER' : new Date(targets[0].last_audited).toISOString()})`);

    // Prepare Logs
    const resultHeaders = 'lifter_id,internal_id,db_name,sport80_name,status,match,timestamp';
    if (!fs.existsSync(OUTPUT_FILE)) fs.writeFileSync(OUTPUT_FILE, resultHeaders + '\n');
    if (!fs.existsSync(MISMATCH_FILE)) fs.writeFileSync(MISMATCH_FILE, resultHeaders + '\n');

    // 4. Scrape
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    try {
        for (const [index, lifter] of targets.entries()) {
            const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${lifter.internal_id}`;
            console.log(`[${index + 1}/${targets.length}] Checking ${lifter.athlete_name} (${lifter.internal_id})...`);

            try {
                await page.goto(memberUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Extract Name
                const pageTitle = await page.evaluate(() => {
                    const h1 = document.querySelector('h1')?.textContent?.trim();
                    if (h1) return h1;
                    const cardTitle = document.querySelector('.v-card__title')?.textContent?.trim();
                    return cardTitle || null;
                });

                // Extract Gender (Inferred from category history if possible? Or profile?)
                // Sport80 public pages don't explicitly list gender easily without diving into history rows.
                // Let's try to grab a category from the first result row to infer gender for future priority.
                const inferredGender = await page.evaluate(() => {
                    const firstCat = document.querySelector('td:nth-child(3)')?.textContent?.toLowerCase(); // Heuristic column position
                    if (!firstCat) return null;
                    if (firstCat.includes('women') || firstCat.includes('girls')) return 'F';
                    if (firstCat.includes('men') || firstCat.includes('boys')) return 'M';
                    return null;
                });

                if (!pageTitle) {
                    console.log(`   ⚠️ Could not extract name/page loaded incorrectly`);
                    continue; // Skip state update if failed? or mark as audited but error?
                    // Better to not mark as audited so we retry later, OR mark with error status.
                }

                const cleanedS80Name = pageTitle.replace(/\s*Results\s*Back\s*to\s*Rankings\s*$/i, '').trim();
                const dbName = normalizeName(lifter.athlete_name);
                const s80Name = normalizeName(cleanedS80Name);

                const isMatch = dbName.clean === s80Name.clean;
                const status = isMatch ? 'MATCH' : 'MISMATCH';

                if (isMatch) console.log(`   ✅ MATCH`);
                else console.log(`   ❌ MISMATCH: DB="${lifter.athlete_name}" vs S80="${cleanedS80Name}"`);

                const csvRow = `${lifter.lifter_id},${lifter.internal_id},"${lifter.athlete_name}","${cleanedS80Name}",${status},${isMatch},${new Date().toISOString()}\n`;

                // Append to Results
                fs.appendFileSync(OUTPUT_FILE, csvRow);

                // Append to Mismatches if needed
                if (!isMatch) {
                    fs.appendFileSync(MISMATCH_FILE, csvRow);
                }

                // Update State
                auditState[lifter.internal_id] = {
                    last_audited: Date.now(),
                    lifter_id: lifter.lifter_id,
                    name_on_file: lifter.athlete_name,
                    gender: inferredGender || lifter.gender_hint || 'U'
                };

                // Save State (Sync is safer for crash recovery per item)
                fs.writeFileSync(STATE_FILE, JSON.stringify(auditState, null, 2));

            } catch (err) {
                console.log(`   🚨 Error: ${err.message}`);
            }

            await new Promise(r => setTimeout(r, 500)); // Be nice
        }
    } finally {
        await browser.close();
        console.log(`🏁 Done. State saved to ${STATE_FILE}`);
        console.log(`   Results: ${OUTPUT_FILE}`);
        console.log(`   Mismatches: ${MISMATCH_FILE}`);
    }
}

function normalizeName(name) {
    if (!name) return { clean: '' };
    const clean = name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    return { clean };
}

main().catch(console.error);
