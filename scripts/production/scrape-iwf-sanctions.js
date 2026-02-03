const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
console.log(`🔑 Using Supabase Key: ${supabaseKey ? '***' + supabaseKey.slice(-5) : 'UNDEFINED'} (Source: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE_KEY' : 'SECRET_KEY'})`);

const supabase = createClient(supabaseUrl, supabaseKey);

async function scrapeSanctions() {
    console.log('🚀 Starting IWF Sanctions Scraper (Smart Incremental)...');

    // Launch with Desktop-like settings
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: { width: 1920, height: 1080 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1920,1080'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('Navigating to https://iwf.sport/anti-doping/sanctions/ ...');
        await page.goto('https://iwf.sport/anti-doping/sanctions/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Get Content
        const content = await page.content();
        const $ = cheerio.load(content);

        // 1. GATHER SCRAPED DATA (In Memory)
        const scrapedSanctions = [];
        const scrapedCountsByYear = {};

        $('.results__title').each((i, titleEl) => {
            const yearText = $(titleEl).find('h2').text().trim();
            const cardsContainer = $(titleEl).next('.cards');

            if (cardsContainer.length) {
                cardsContainer.children('.card').each((j, cardEl) => {
                    if ($(cardEl).hasClass('card__legend')) return;

                    const card = $(cardEl);
                    const cardHtml = card.html();

                    // --- Robust Parsing ---
                    // [Filter Bad Footer Cards]
                    if (card.text().includes('IC - In Competition')) return;

                    let name = card.find('.title strong').text().trim();
                    if (!name) name = card.find('strong').first().text().trim();
                    if (name && name.length < 3) return;

                    let nation = card.find('.col-5 p.title').text().trim().replace(/[\n\r]+/g, '').trim();
                    if (!nation) {
                        const match = card.text().match(/\b[A-Z]{3}\b/);
                        if (match) nation = match[0];
                    }

                    let fromText = '';
                    let untilText = '';
                    let eventText = '';
                    let substanceText = '';

                    card.find('p.normal__text').each((_, el) => {
                        const t = $(el).text();
                        if (t.includes('From:')) fromText = t.replace('From:', '').trim();
                        if (t.includes('Until:')) untilText = t.replace('Until:', '').trim();
                        if (t.includes('Event type*:')) eventText = t.replace('Event type*:', '').trim();
                        if (t.includes('Substance/ADRV:')) substanceText = t.replace('Substance/ADRV:', '').trim();
                    });

                    // CI Diagnostic
                    if (i === 0 && j === 0) {
                        console.log('--- [CI DIAGNOSTIC] HTML of First Card ---');
                        console.log(cardHtml.substring(0, 300) + '...');
                        console.log(`--- [CI DIAGNOSTIC] Extracted: Name=${name}, Nation=${nation}, From=${fromText}`);
                    }

                    if (name) {
                        const s = {
                            name,
                            nation,
                            from: fromText,
                            until: untilText,
                            event: eventText,
                            substance: substanceText,
                            yearGroup: yearText
                        };
                        scrapedSanctions.push(s);
                        scrapedCountsByYear[yearText] = (scrapedCountsByYear[yearText] || 0) + 1;
                    }
                });
            }
        });

        // Unique Filter
        const uniqueScraped = [];
        const seen = new Set();
        const uniqueCountsByYear = {}; // Recalculate based on unique

        for (const s of scrapedSanctions) {
            const safeFrom = s.from || 'UNKNOWN_START';
            const safeSubstance = s.substance || 'UNKNOWN_SUBSTANCE';
            const sig = `${s.name}|${safeFrom}|${safeSubstance}`;

            if (!seen.has(sig)) {
                seen.add(sig);
                uniqueScraped.push(s);
                uniqueCountsByYear[s.yearGroup] = (uniqueCountsByYear[s.yearGroup] || 0) + 1;
            }
        }

        console.log(`📊 Scraped Total: ${uniqueScraped.length} unique records.`);

        // 2. FETCH DB STATS
        const { data: dbRows, error: dbError } = await supabase
            .from('iwf_sanctions')
            .select('id, sanction_year_group');

        if (dbError) throw dbError;

        const dbCountsByYear = {};
        dbRows.forEach(r => {
            const y = r.sanction_year_group || 'Unknown';
            dbCountsByYear[y] = (dbCountsByYear[y] || 0) + 1;
        });

        const totalDbCount = dbRows.length;
        const totalScrapedCount = uniqueScraped.length;

        console.log(`📊 Database Total: ${totalDbCount} records.`);

        // 3. GLOBAL CHECK
        if (totalDbCount === totalScrapedCount) {
            console.log('✅ Global counts match exactly. Checking if Year Groups differ...');
        }

        // 4. GROUP CHECK
        const yearsToProcess = new Set();
        const scYears = Object.keys(uniqueCountsByYear);

        // [FORCE RECHECK LOGIC]
        const forceRecheck = process.env.FORCE_RECHECK === 'true';
        if (forceRecheck) console.log('⚠️  FORCE_RECHECK enabled: Checking ALL years for data improvements...');

        for (const year of scYears) {
            const sCount = uniqueCountsByYear[year];
            const dCount = dbCountsByYear[year] || 0;

            if (forceRecheck || sCount !== dCount) {
                if (!forceRecheck) console.log(`⚠️  Mismatch in ${year}: DB=${dCount}, Scraper=${sCount}. Marking for update.`);
                yearsToProcess.add(year);
            }
        }

        if (yearsToProcess.size === 0) {
            console.log('🎉 All Year Group counts match. NO UPDATES REQUIRED.');
            return; // EXIT
        }

        console.log(`🔄 Processing updates for ${yearsToProcess.size} year groups: ${Array.from(yearsToProcess).join(', ')}`);

        // 5. DRILL DOWN & INSERT
        const candidates = uniqueScraped.filter(s => yearsToProcess.has(s.yearGroup));

        for (const sanction of candidates) {
            await processSanction(sanction);
        }

    } catch (error) {
        console.error('Fatal Error:', error);
    } finally {
        await browser.close();
    }
}

async function processSanction(sanction) {
    let { name, nation, from, until, event, substance, yearGroup } = sanction;

    // [CLEANING]
    if (name.includes('GRELA') && from && from.includes('202') && from.length < 10) from = '2020-07-04';

    let cleanName = name;
    let gender = null;
    let notes = [];

    if (cleanName.toLowerCase().includes('(m)')) { gender = 'M'; cleanName = cleanName.replace(/\(m\)/gi, ''); }
    else if (cleanName.toLowerCase().includes('(w)')) { gender = 'W'; cleanName = cleanName.replace(/\(w\)/gi, ''); }
    if (/re-analysis/i.test(cleanName)) { notes.push('Re-analysis'); cleanName = cleanName.replace(/re-analysis/gi, ''); }

    const dateRegexInName = /(\d{2}[.-]\d{2}[.-]\d{4})/g;
    let dateMatch;
    while ((dateMatch = dateRegexInName.exec(cleanName)) !== null) {
        notes.push(`Date in name: ${dateMatch[1]}`);
        cleanName = cleanName.replace(dateMatch[1], '');
    }

    if (cleanName.includes('*')) {
        const parts = cleanName.split('*');
        cleanName = parts[0];
        if (parts[1]) notes.push(parts[1].trim());
    }

    const parenRegex = /\(([^)]+)\)/g;
    let match;
    while ((match = parenRegex.exec(cleanName)) !== null) {
        const content = match[1].trim();
        if (content && !notes.includes(content)) notes.push(content);
    }
    cleanName = cleanName.replace(/\([^)]*\)/g, '');

    cleanName = cleanName.replace(/\s+/g, ' ').trim();
    cleanName = cleanName.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    cleanName = cleanName.replace(/^(Ms\.|Mr\.|Mrs\.)\s*/i, '');

    if (/\/(Ms\.?|Mr\.?|Mrs\.?)/i.test(cleanName)) {
        const parts = cleanName.split(' ');
        const suffixIndex = parts.findIndex(p => /\/(Ms\.?|Mr\.?|Mrs\.?)/i.test(p));
        if (suffixIndex !== -1) {
            const match = parts[suffixIndex].match(/\/(Ms\.?|Mr\.?|Mrs\.?)/i);
            const title = match[1];
            const firstname = parts[suffixIndex].replace(match[0], '');
            const surnameParts = parts.filter((_, idx) => idx !== suffixIndex);
            let normTitle = title.replace('.', '').toLowerCase();
            normTitle = normTitle.charAt(0).toUpperCase() + normTitle.slice(1) + '.';
            cleanName = `${normTitle} ${firstname} ${surnameParts.join(' ')}`;
        }
    }

    const parts = cleanName.split(' ');
    let firstLowerIndex = -1;
    for (let i = 0; i < parts.length; i++) {
        if (/^(Ms\.|Mr\.|Mrs\.)$/.test(parts[i])) continue;
        if (/[a-z]/.test(parts[i])) { firstLowerIndex = i; break; }
    }
    if (firstLowerIndex > 0) {
        const surnameParts = parts.slice(0, firstLowerIndex);
        const firstnameParts = parts.slice(firstLowerIndex);
        cleanName = [...firstnameParts, ...surnameParts].join(' ');
    }
    cleanName = cleanName.trim();

    // [VALIDATION] Ensure name didn't become empty after cleaning
    if (!cleanName || cleanName.length < 2) {
        console.warn(`⚠️  Skipping garbage record (Name became empty): "${name}"`);
        return;
    }

    const startDate = parseDate(from);
    const endDate = parseDate(until);
    const duration = calculateFriendlyDuration(startDate, endDate);
    const notesStr = notes.length > 0 ? notes.join('; ') : null;

    // 2. Lifter Match
    let dbLiferId = null;
    try {
        let candidates = await findLifter(cleanName, nation);
        if (candidates.match) dbLiferId = candidates.id;
        else {
            const nameParts = cleanName.split(' ');
            if (nameParts.length === 2) {
                const reversed = `${nameParts[1]} ${nameParts[0]}`;
                let revCand = await findLifter(reversed, nation);
                if (revCand.match) dbLiferId = revCand.id;
            }
        }
    } catch (e) { console.error(e); }

    // 3. CHECK EXISTENCE (INSERT IF NOT EXISTS)
    let query = supabase.from('iwf_sanctions').select('id').eq('name', cleanName);

    if (startDate) query = query.eq('start_date', startDate);
    else query = query.is('start_date', null);

    // Fix: Handle empty string vs NULL ambiguity for substance
    if (substance) {
        query = query.eq('substance', substance);
    } else {
        // Check for EITHER null OR empty string
        query = query.or('substance.is.null,substance.eq.""');
    }

    const { data: existingRecords } = await query;
    const exists = existingRecords && existingRecords.length > 0;

    if (exists) {
        // [DATA IMPROVEMENT CHECK]
        // If we found a record, but our scraped data is "better" (has text date where DB has NULL), UPDATE it.
        const r = existingRecords[0]; // The specific record

        // We need to fetch the existing fields to compare.
        // Wait, 'select('id')' only fetched ID. We need more to compare.
        // Let's assume we need to update if local has text and we are in FORCE_RECHECK, 
        // OR just unconditionally update date fields if they are missing in DB but present here.
        // To be safe/efficient, let's fetch current state *now* if we plan to improve.

        const { data: current } = await supabase.from('iwf_sanctions').select('start_date, end_date').eq('id', r.id).single();

        if (current) {
            let needsUpdate = false;
            let updates = {};

            // Check End Date (LIFE, CAS)
            if (endDate && !current.end_date) {
                console.log(`✨  Improving Record ${cleanName}: EndDate NULL -> "${endDate}"`);
                updates.end_date = endDate;
                needsUpdate = true;
            }
            // Check Start Date (RETIRED)
            if (startDate && !current.start_date) {
                console.log(`✨  Improving Record ${cleanName}: StartDate NULL -> "${startDate}"`);
                updates.start_date = startDate;
                needsUpdate = true;
            }

            if (needsUpdate) {
                const { error: upErr } = await supabase.from('iwf_sanctions').update(updates).eq('id', r.id);
                if (upErr) console.error(`❌ Error updating ${cleanName}:`, upErr.message);
                else console.log(`✅ Updated ${cleanName}`);
            }
        }

        return;
    }

    // Insert New
    const payload = {
        name: cleanName,
        gender: gender,
        nation: nation,
        start_date: startDate,
        end_date: endDate,
        duration: duration,
        notes: notesStr,
        event_type: event,
        substance: substance,
        sanction_year_group: yearGroup,
        db_lifter_id: dbLiferId
    };

    const { error } = await supabase.from('iwf_sanctions').insert(payload);

    if (error) console.error(`❌ Error inserting ${cleanName}:`, error.message);
    else console.log(`✅ Inserted new: ${cleanName}`);
}

async function findLifter(nameVal, nationVal) {
    const { data } = await supabase
        .from('iwf_lifters')
        .select('db_lifter_id, athlete_name, country_code')
        .eq('country_code', nationVal)
        .ilike('athlete_name', nameVal);

    if (data && data.length === 1) return { match: true, id: data[0].db_lifter_id };
    return { match: false, candidates: data };
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    let cleanStr = dateStr.trim().replace(/\.\./g, '.');

    // [Check for Special Text Values First]
    // If it contains "LIFE", "CAS", "RETIRED", or "year", return the raw text (cleaned)
    // The DB column is TEXT, so this is allowed.
    if (/(LIFE|CAS|RETIRED|year|month|provisional)/i.test(cleanStr)) {
        return cleanStr;
    }

    let result = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) result = cleanStr;
    else if (/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.test(cleanStr)) {
        let match = cleanStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        result = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }
    else if (/^(\d{1,2})-(\d{1,2})-(\d{4})$/.test(cleanStr)) {
        let match = cleanStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        result = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }

    if (result) {
        const year = parseInt(result.split('-')[0], 10);
        if (year < 1990 || year > 2040) return null;
        return result;
    }

    // Fallback: If it's not a date but has length, maybe return it? 
    // Safest to return null unless it matches valid text patterns to avoid preserving garbage like "From:"
    return null;
}

function calculateFriendlyDuration(start, end) {
    if (!start || !end) return null;
    if (end.toUpperCase() === 'LIFE') return 'LIFE';
    const d1 = new Date(start);
    const d2 = new Date(end);
    if (isNaN(d1) || isNaN(d2)) return null;
    let years = d2.getFullYear() - d1.getFullYear();
    let months = d2.getMonth() - d1.getMonth();
    let days = d2.getDate() - d1.getDate();
    if (days < 0) {
        months--;
        days += new Date(d2.getFullYear(), d2.getMonth(), 0).getDate();
    }
    if (months < 0) {
        years--;
        months += 12;
    }
    const parts = [];
    if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    return parts.length > 0 ? parts.join(' ') : '0 days';
}

scrapeSanctions();
