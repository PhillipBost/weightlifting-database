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
    console.log('🚀 Starting IWF Sanctions Scraper...');

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

        // Set a standard Desktop User Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navigate
        console.log('Navigating to https://iwf.sport/anti-doping/sanctions/ ...');
        await page.goto('https://iwf.sport/anti-doping/sanctions/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Get Content
        const content = await page.content();
        const $ = cheerio.load(content);

        const sanctions = [];

        $('.results__title').each((i, titleEl) => {
            const yearText = $(titleEl).find('h2').text().trim();
            const cardsContainer = $(titleEl).next('.cards');

            if (cardsContainer.length) {
                cardsContainer.children('.card').each((j, cardEl) => {
                    // Skip legend card
                    if ($(cardEl).hasClass('card__legend')) return;

                    const card = $(cardEl);
                    const cols = card.find('.col-md-4');

                    // Name and Nation
                    const nameCol = cols.eq(0);
                    const nameSelector = '.col-7 p.title strong';
                    const name = nameCol.find(nameSelector).text().trim();
                    const nation = nameCol.find('.col-5 p.title').text().trim().replace(/[\n\r]+/g, '').trim();

                    // Dates - Search by text "From:" and "Until:" for robustness
                    let fromText = '';
                    let untilText = '';
                    const dateCol = cols.eq(1);

                    // Robust extraction: Iterate p.normal__text and check content
                    dateCol.find('p.normal__text').each((_, el) => {
                        const t = $(el).text();
                        if (t.includes('From:')) fromText = t.replace('From:', '').trim();
                        if (t.includes('Until:')) untilText = t.replace('Until:', '').trim();
                    });

                    // Fallback to old position-based if text-search fails (rare but possible if layout matches old)
                    if (!fromText && dateCol.find('.col-6').eq(0).length) {
                        fromText = dateCol.find('.col-6').eq(0).find('p.normal__text').text().replace('From:', '').trim();
                    }
                    if (!untilText && dateCol.find('.col-6').eq(1).length) {
                        untilText = dateCol.find('.col-6').eq(1).find('p.normal__text').text().replace('Until:', '').trim();
                    }

                    // Event / Substance - Search by text
                    let eventText = '';
                    let substanceText = '';

                    card.find('.col-md-2 p.normal__text').each((_, el) => {
                        const t = $(el).text();
                        if (t.includes('Event type*:')) eventText = t.replace('Event type*:', '').trim();
                        if (t.includes('Substance/ADRV:')) substanceText = t.replace('Substance/ADRV:', '').trim();
                    });

                    if (name) {
                        sanctions.push({
                            name,
                            nation,
                            from: fromText,
                            until: untilText,
                            event: eventText,
                            substance: substanceText,
                            yearGroup: yearText,
                            _rawHtml: (fromText ? null : card.html()) // Save raw HTML if critical data missing
                        });
                    }
                });
            }
        });

        console.log(`Found ${sanctions.length} raw sanctions.`);

        // Detect duplicates before processing
        const uniqueSanctions = [];
        const seen = new Set();
        let invalidCount = 0;

        for (const s of sanctions) {
            // [Adjusted Strategy]
            // We ALLOW missing fields now because historical data (e.g. 2009) often lacks "From" date or "Substance".
            // We only skip if the NAME is missing (which shouldn't happen due to previous checks).

            if (!s.name) {
                invalidCount++;
                continue;
            }

            // Create a unique signature based on KEY fields
            // Use fallback strings to ensure uniqueness even if fields are null
            const safeFrom = s.from || 'UNKNOWN_START';
            const safeSubstance = s.substance || 'UNKNOWN_SUBSTANCE';

            const sig = `${s.name}|${safeFrom}|${safeSubstance}`;

            if (seen.has(sig)) {
                // console.log(`Duplicate found: ${s.name}`);
            } else {
                seen.add(sig);
                uniqueSanctions.push(s);
            }
        }

        console.log(`Processing ${uniqueSanctions.length} unique sanctions.`);
        if (invalidCount > 0) {
            console.warn(`Dropped ${invalidCount} rows with no name.`);
        }

        // Process in batches
        for (const sanction of uniqueSanctions) {
            await processSanction(sanction);
        }

    } catch (error) {
        console.error('Fatal Error:', error);
    } finally {
        await browser.close();
    }
}

async function processSanction(sanction) {
    // 1. Parse Data
    let { name, nation, from, until, event, substance, yearGroup } = sanction;

    // [Manual Data Fixes for Known Source Typos]
    // Fix: Lukasz GRELA (07.04.202 -> 2020-07-04)
    if (name.includes('GRELA') && from && from.includes('202') && from.length < 10) {
        // Force correct date
        from = '2020-07-04';
    }

    let cleanName = name;
    let gender = null;
    let notes = [];

    // [Gender]
    if (cleanName.toLowerCase().includes('(m)')) {
        gender = 'M';
        cleanName = cleanName.replace(/\(m\)/gi, '');
    } else if (cleanName.toLowerCase().includes('(w)')) {
        gender = 'W';
        cleanName = cleanName.replace(/\(w\)/gi, '');
    }

    // [Re-analysis] - Extract to notes
    if (/re-analysis/i.test(cleanName)) {
        notes.push('Re-analysis');
        cleanName = cleanName.replace(/re-analysis/gi, '');
    }

    // [Dates in Name] 01.05.2025
    const dateRegexInName = /(\d{2}[.-]\d{2}[.-]\d{4})/g;
    let dateMatch;
    while ((dateMatch = dateRegexInName.exec(cleanName)) !== null) {
        notes.push(`Date in name: ${dateMatch[1]}`);
        cleanName = cleanName.replace(dateMatch[1], '');
    }

    // [Suspended by]
    if (cleanName.includes('*')) {
        const parts = cleanName.split('*');
        cleanName = parts[0];
        if (parts[1]) notes.push(parts[1].trim());
    }

    // [Parentheses Content]
    const parenRegex = /\(([^)]+)\)/g;
    let match;
    while ((match = parenRegex.exec(cleanName)) !== null) {
        const content = match[1].trim();
        if (content && !notes.includes(content)) {
            notes.push(content);
        }
    }
    cleanName = cleanName.replace(/\([^)]*\)/g, '');

    // [Whitespace / Punctuation]
    cleanName = cleanName.replace(/\s+/g, ' ').trim();
    // Remove leading/trailing non-alphanumeric chars (like wild dashes)
    cleanName = cleanName.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    // Remove "Ms." / "Mr." prefixes (Standard)
    cleanName = cleanName.replace(/^(Ms\.|Mr\.|Mrs\.)\s*/i, '');

    // [Handle Suffix Titles like "FIRSTNAME/Ms."]
    // Example: "CALLES CELENIA/Ms." -> "Ms. CELENIA CALLES"
    // Relaxed Regex: Allow "Ms" without dot
    if (/\/(Ms\.?|Mr\.?|Mrs\.?)/i.test(cleanName)) {
        const parts = cleanName.split(' ');
        const suffixIndex = parts.findIndex(p => /\/(Ms\.?|Mr\.?|Mrs\.?)/i.test(p));

        if (suffixIndex !== -1) {
            // Extract title
            const match = parts[suffixIndex].match(/\/(Ms\.?|Mr\.?|Mrs\.?)/i);
            const title = match[1]; // "Ms." or "Mr"

            // Clean the firstname part
            const firstname = parts[suffixIndex].replace(match[0], '');

            // Collect surname parts (everything else)
            const surnameParts = parts.filter((_, idx) => idx !== suffixIndex);

            // Reconstruct: Title Firstname Surname
            let normTitle = title.replace('.', '').toLowerCase();
            normTitle = normTitle.charAt(0).toUpperCase() + normTitle.slice(1) + '.'; // Force "Ms."

            cleanName = `${normTitle} ${firstname} ${surnameParts.join(' ')}`;
        }
    }

    // [Name Case Handling]
    // Goal: "LOPEZ LOPEZ Yeison" -> "Yeison LOPEZ LOPEZ"
    // Strategy: Split into words. Find the index where "Lowercase-containing words" start.
    const parts = cleanName.split(' ');

    let firstLowerIndex = -1;
    for (let i = 0; i < parts.length; i++) {
        // Skip Title if checking for mixed case words
        if (/^(Ms\.|Mr\.|Mrs\.)$/.test(parts[i])) continue;

        if (/[a-z]/.test(parts[i])) { // Word has ANY lowercase letter
            firstLowerIndex = i;
            break;
        }
    }

    // If we found a lowercase word, and it wasn't the very first word...
    if (firstLowerIndex > 0) {
        // The parts BEFORE firstLowerIndex are the "Surname/Prefix" (ALLCAPS).
        // The parts FROM firstLowerIndex are the "Firstname" (TitleCase).

        // Handle if index 0 is Title (Ms. SURNAME Firstname) -> Unusual but possible
        // Standard expected: SURNAME Firstname

        const surnameParts = parts.slice(0, firstLowerIndex);
        const firstnameParts = parts.slice(firstLowerIndex);

        cleanName = [...firstnameParts, ...surnameParts].join(' ');
    }

    // [Date Conversion & Duration]
    const startDate = parseDate(from);
    // Note: If parseDate returns null, strict mode will leave it null

    const endDate = parseDate(until);
    const duration = calculateFriendlyDuration(startDate, endDate);

    const notesStr = notes.length > 0 ? notes.join('; ') : null;

    // 2. Match Lifter
    let dbLiferId = null;
    try {
        // matchStrategy: 1. Exact Name match
        // Attempt 1: As cleaned
        let candidates = await findLifter(cleanName, nation);

        if (candidates.match) {
            dbLiferId = candidates.id;
        } else {
            // Attempt 2: Swapping first/last name if 2 words (fallback)
            const nameParts = cleanName.split(' ');
            if (nameParts.length === 2) {
                const reversed = `${nameParts[1]} ${nameParts[0]}`;
                let revCand = await findLifter(reversed, nation);
                if (revCand.match) dbLiferId = revCand.id;
            }
        }
    } catch (e) {
        console.error('Error matching lifter:', e);
    }

    // 3. Upsert
    // [Smart Upsert Strategy]
    // We want to preserve manual edits to 'db_lifter_id' and 'gender' if the scraper finds nothing (NULL).
    // Check if record exists first.
    let finalLifterId = dbLiferId;
    let finalGender = gender;

    const { data: existingRecord } = await supabase
        .from('iwf_sanctions')
        .select('id, db_lifter_id, gender')
        .eq('name', cleanName)
        .eq('start_date', startDate)
        .eq('substance', substance)
        .maybeSingle();

    if (existingRecord) {
        // preserve DB value if we have nothing better
        if (existingRecord.db_lifter_id && !finalLifterId) {
            finalLifterId = existingRecord.db_lifter_id;
        }
        // Optional: If you trust your manual overrides MORE than the scraper even if scraper found something:
        // finalLifterId = existingRecord.db_lifter_id || finalLifterId; 

        if (existingRecord.gender && !finalGender) {
            finalGender = existingRecord.gender;
        }
    }

    const payload = {
        name: cleanName,
        gender: finalGender,
        nation: nation,
        start_date: startDate,
        end_date: endDate,
        duration: duration,
        notes: notesStr,
        event_type: event,
        substance: substance,
        sanction_year_group: yearGroup,
        db_lifter_id: finalLifterId
    };

    const { error: upsertError } = await supabase
        .from('iwf_sanctions')
        .upsert(payload, { onConflict: 'name, start_date, substance' });

    if (upsertError) {
        console.error(`Error saving sanction for ${cleanName}:`, upsertError.message);
    } else {
        process.stdout.write('.');
    }
}

async function findLifter(nameVal, nationVal) {
    // Search by athlete_name (ilike) and country_code
    // FIX: Corrected columns `athlete_name` and `country_code` confirmed by debug.
    const { data } = await supabase
        .from('iwf_lifters')
        .select('db_lifter_id, athlete_name, country_code')
        .eq('country_code', nationVal)
        .ilike('athlete_name', nameVal);

    if (data && data.length === 1) {
        return { match: true, id: data[0].db_lifter_id };
    }
    return { match: false, candidates: data };
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    let cleanStr = dateStr.trim();
    // Use heuristic to fix double dots e.g. 13.04..2015
    cleanStr = cleanStr.replace(/\.\./g, '.');

    let result = null;

    // 1. Format: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
        result = cleanStr;
    }
    // 2. Format: DD.MM.YYYY
    else {
        let match = cleanStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (match) {
            result = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
        }
        // 3. Format: DD-MM-YYYY
        else {
            match = cleanStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
            if (match) {
                result = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
            }
        }
    }

    // 4. Sanity Check: Year Range (1990 - 2040)
    // This prevents "Year 202" from being accepted
    if (result) {
        const year = parseInt(result.split('-')[0], 10);
        if (year < 1990 || year > 2040) {
            // console.warn(`⚠️  Date out of sensible range (dropped): ${dateStr} -> ${result}`);
            return null;
        }
    } else {
        // If regex didn't match anything valid (like "07.04.202"), return null instead of raw garbage
        return null;
    }

    return result;
}

function calculateFriendlyDuration(start, end) {
    if (!start || !end) return null;
    if (end.toUpperCase() === 'LIFE') return 'LIFE';

    // Basic validation YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start) || !dateRegex.test(end)) return null;

    const d1 = new Date(start);
    const d2 = new Date(end);

    if (isNaN(d1) || isNaN(d2)) return null;

    // Calculate diff
    // Logic: years, months, days
    let years = d2.getFullYear() - d1.getFullYear();
    let months = d2.getMonth() - d1.getMonth();
    let days = d2.getDate() - d1.getDate();

    if (days < 0) {
        months--;
        // Get days in previous month
        const prevMonth = new Date(d2.getFullYear(), d2.getMonth(), 0);
        days += prevMonth.getDate();
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
