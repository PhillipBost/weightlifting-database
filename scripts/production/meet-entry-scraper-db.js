/**
 * MEET ENTRY SCRAPER (DATABASE VERSION)
 * 
 * Scrapes meet entries from Sport80 and saves them to Supabase `usaw_meet_entries`.
 * Handles:
 *  - Finding Meets in `usaw_meets` (Read-only for meets)
 *  - Finding or Creating Lifters in `usaw_lifters`
 *  - Upserting Entries (deduplicated by meet_id/meet_name + member_id)
 * 
 * Usage:
 *   node meet-entry-scraper-db.js --days 30
 *   node meet-entry-scraper-db.js --year 2024
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const { findOrCreateLifterEnhanced } = require('./findOrCreateLifter-enhanced');
const fs = require('fs');
const path = require('path');

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Logging helper
function log(msg) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${msg}`);
}

// State to WSO mapping helper
// Based EXACTLY on wso_information table query results (26 active WSOs)
// Returns NULL for states not explicitly listed or California (needs county data)
function getWSOFromState(state) {
    if (!state) return null;

    const stateUpper = state.toUpperCase().trim();

    // Single-state WSOs (from wso_information)
    const singleStateMap = {
        'ALABAMA': 'Alabama', 'AL': 'Alabama',
        'FLORIDA': 'Florida', 'FL': 'Florida',
        'GEORGIA': 'Georgia', 'GA': 'Georgia',
        'ILLINOIS': 'Illinois', 'IL': 'Illinois',
        'INDIANA': 'Indiana', 'IN': 'Indiana',
        'MICHIGAN': 'Michigan', 'MI': 'Michigan',
        'NEW JERSEY': 'New Jersey', 'NJ': 'New Jersey',
        'NEW YORK': 'New York', 'NY': 'New York',
        'OHIO': 'Ohio', 'OH': 'Ohio',
        'WISCONSIN': 'Wisconsin', 'WI': 'Wisconsin'
    };

    if (singleStateMap[stateUpper]) {
        return singleStateMap[stateUpper];
    }

    // Multi-state/Regional WSOs (from wso_information)
    if (['NORTH CAROLINA', 'NC', 'SOUTH CAROLINA', 'SC'].includes(stateUpper)) {
        return 'Carolina';
    }
    if (['DELAWARE', 'DE', 'MARYLAND', 'MD', 'VIRGINIA', 'VA', 'DISTRICT OF COLUMBIA', 'DC'].includes(stateUpper)) {
        return 'DMV';
    }
    if (['HAWAII', 'HI'].includes(stateUpper)) {
        return 'Hawaii and International';
    }
    if (['MINNESOTA', 'MN', 'NORTH DAKOTA', 'ND', 'SOUTH DAKOTA', 'SD'].includes(stateUpper)) {
        return 'Minnesota-Dakotas';
    }
    if (['MISSOURI', 'MO', 'KANSAS', 'KS'].includes(stateUpper)) {
        return 'Missouri Valley';
    }
    if (['IOWA', 'IA', 'NEBRASKA', 'NE'].includes(stateUpper)) {
        return 'Iowa-Nebraska';
    }
    if (['MONTANA', 'MT', 'IDAHO', 'ID', 'COLORADO', 'CO', 'WYOMING', 'WY'].includes(stateUpper)) {
        return 'Mountain North';
    }
    if (['UTAH', 'UT', 'ARIZONA', 'AZ', 'NEW MEXICO', 'NM', 'NEVADA', 'NV'].includes(stateUpper)) {
        return 'Mountain South';
    }
    if (['MAINE', 'ME', 'NEW HAMPSHIRE', 'NH', 'VERMONT', 'VT', 'MASSACHUSETTS', 'MA', 'RHODE ISLAND', 'RI', 'CONNECTICUT', 'CT'].includes(stateUpper)) {
        return 'New England';
    }
    if (['WASHINGTON', 'WA', 'OREGON', 'OR', 'ALASKA', 'AK'].includes(stateUpper)) {
        return 'Pacific Northwest';
    }
    if (['PENNSYLVANIA', 'PA', 'WEST VIRGINIA', 'WV'].includes(stateUpper)) {
        return 'Pennsylvania-West Virginia';
    }
    if (['LOUISIANA', 'LA', 'MISSISSIPPI', 'MS', 'ARKANSAS', 'AR'].includes(stateUpper)) {
        return 'Southern';
    }
    if (['TENNESSEE', 'TN', 'KENTUCKY', 'KY'].includes(stateUpper)) {
        return 'Tennessee-Kentucky';
    }
    if (['TEXAS', 'TX', 'OKLAHOMA', 'OK'].includes(stateUpper)) {
        return 'Texas-Oklahoma';
    }

    // California: Cannot determine WSO without county (has 2 county-based WSOs)
    // Any other state not in wso_information also returns NULL
    return null;
}

// ------------- BROWSER LOGIC -------------

let browser, page;

async function initBrowser() {
    log('Initializing browser...');
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
}

function buildEventsURL(fromDate, toDate) {
    const filters = {
        from_date: fromDate,
        to_date: toDate,
        event_type: 11 // Weightlifting
    };
    const filtersStr = Buffer.from(JSON.stringify(filters)).toString('base64');
    return `https://usaweightlifting.sport80.com/public/events?filters=${filtersStr}`;
}

async function scrapeMeetBasicInfo() {
    return await page.evaluate(() => {
        const meetRows = document.querySelectorAll('.row.no-gutters.align-center');
        const meets = [];

        for (const row of meetRows) {
            const nameEl = row.querySelector('strong');
            const infoEl = row.querySelector('span.d-block.mt-2.grey--text');

            if (nameEl && infoEl) {
                const meetName = nameEl.textContent.trim();
                const infoText = infoEl.textContent.trim();

                const parts = infoText.split(' - ');
                let dateRange = infoText;
                let location = '';

                if (parts.length >= 2) {
                    location = parts[parts.length - 1].trim();
                    dateRange = parts.slice(0, parts.length - 1).join(' - ').trim();
                }

                meets.push({ meet_name: meetName, date_range: dateRange, location: location });
            }
        }
        return meets;
    });
}

async function scrapeDetailedMeetInfo(rowIndex) {
    try {
        // Click the expansion panel header
        const clicked = await page.evaluate((idx) => {
            const headers = document.querySelectorAll('.v-expansion-panel-header');
            if (headers[idx]) {
                headers[idx].click();
                return true;
            }
            return false;
        }, rowIndex);

        if (!clicked) return {};

        // Wait for expansion content
        await new Promise(r => setTimeout(r, 1500));

        // Extract detailed info from expansion panel
        const details = await page.evaluate((idx) => {
            const data = {};

            // Scope to the specific expansion panel content
            // Assuming 1:1 mapping between headers and panels
            const panels = document.querySelectorAll('.v-expansion-panel');
            const panel = panels[idx];

            if (!panel) return data;

            // Helper to extract labeled data WITHIN the panel
            const getByLabel = (labelText) => {
                // Find all labels INSIDE this panel
                const labels = Array.from(panel.querySelectorAll('label'));
                const label = labels.find(l => l.textContent.includes(labelText));
                if (label) {
                    const parent = label.closest('.row');
                    if (parent) {
                        const dataItem = parent.querySelector('.s80-data-item span');
                        return dataItem ? dataItem.textContent.trim() : '';
                    }
                }
                return '';
            };

            // Extract from list items (address, phone, email) WITHIN the panel
            const listItems = panel.querySelectorAll('.v-list-item');
            for (const item of listItems) {
                const icon = item.querySelector('.mdi');
                const content = item.querySelector('.v-list-item__title');
                if (icon && content) {
                    const text = content.textContent.trim();
                    // Try to match by icon class
                    if (icon.classList.contains('mdi-map-marker-outline')) {
                        data.address = text;
                    } else if (icon.classList.contains('mdi-phone-outline') || icon.classList.contains('mdi-phone')) {
                        data.phone = text;
                    } else if (icon.classList.contains('mdi-email-outline') || icon.classList.contains('mdi-email')) {
                        data.email = text;
                    } else {
                        // Fallback: Check text content patterns
                        if (text.includes('@')) {
                            data.email = text;
                        } else if (/[\d-]{10,}/.test(text)) {
                            data.phone = text;
                        }
                    }
                }
            }

            // Extract labeled data
            data.type = getByLabel('Type');
            data.meetType = getByLabel('Meet Type');
            data.entriesOnPlatform = getByLabel('Entries On Platform') === 'YES';
            data.registrationOpen = getByLabel('Registrations Open');
            data.registrationClose = getByLabel('Registrations Close');
            data.organizer = getByLabel('Meet Organizer');

            return data;
        }, rowIndex); // Pass rowIndex to evaluate block

        return details;
    } catch (e) {
        log(`  ⚠️ Could not scrape detailed info: ${e.message}`);
        return {};
    }
}

async function scrapeInnerMeetDetails(targetPage) {
    try {
        // Wait for the icon to appear (wizard page load)
        await targetPage.waitForSelector('.s80-icon.mdi-information, .mdi-information', { timeout: 10000 }).catch(() => { });

        return await targetPage.evaluate(async () => {
            let description = '';

            const infoIcon = document.querySelector('.s80-icon.mdi-information, .mdi-information');

            if (infoIcon) {
                // Go up to the icon container (.v-list-item__icon)
                const iconContainer = infoIcon.closest('.v-list-item__icon');

                if (iconContainer) {
                    // content is usually the next sibling
                    const contentContainer = iconContainer.nextElementSibling;

                    if (contentContainer && contentContainer.classList.contains('v-list-item__content')) {
                        // Check for "Show more" inside this content
                        // Note: User says: <span class="text-padding">Show more</span> in a clickable element.
                        // We'll search for 'Show more' text.
                        const buttons = Array.from(contentContainer.querySelectorAll('button, .v-btn, [role="button"], span.text-padding'));

                        const showMoreBtn = buttons.find(b => b.textContent && b.textContent.toLowerCase().includes('show more'));

                        if (showMoreBtn) {
                            showMoreBtn.click();
                            await new Promise(r => setTimeout(r, 1500)); // Wait for dialog animation
                        }

                        // Check if a dialog opened!
                        // User snippet: <div class="s80-card dialog-card">...<div class="dialog-content">...
                        const dialogContent = document.querySelector('.dialog-card .dialog-content');

                        if (dialogContent) {
                            // Loop through children to get clean text (skipping images if possible, or just textContent)
                            // innerText preserves newlines better than textContent
                            description = dialogContent.innerText || dialogContent.textContent;

                            // Close the dialog
                            const closeBtn = document.querySelector('.dialog-card .close-button, .dialog-card button.close-button');
                            if (closeBtn) {
                                closeBtn.click();
                                await new Promise(r => setTimeout(r, 800)); // Wait for close
                            }
                        } else {
                            // Fallback: Extract text from the specific container if no dialog appeared
                            description = contentContainer.innerText || contentContainer.textContent;

                            // Clean up "Show more" text itself if it remains
                            description = description.replace(/Show more/gi, '').replace(/Show less/gi, '');
                        }

                        description = description.trim();

                        // Clean up known "junk" that might be appended
                        // "Get Started" is the footer junk.
                        if (description.includes('Get Started')) {
                            description = description.split('Get Started')[0].trim();
                        }
                        if (description.includes('Organizer')) { // prevent running into organizer details
                            description = description.split('Organizer')[0].trim();
                        }
                    } else {
                        return { description: null, error: 'No content sibling found' };
                    }
                } else {
                    // Fallback to previous parent logic if structure differs
                    const parent = infoIcon.closest('.row') || infoIcon.closest('.v-list-item');
                    if (parent) {
                        description = parent.textContent.trim();
                    }
                }
            } else {
                return { description: null, error: 'No info icon found' };
            }

            return { description };
        });
    } catch (e) {
        log(`  ⚠️ Failed to scrape inner details: ${e.message}`);
        return { description: null };
    }
}

async function findEntryButtonOnWizard(targetPage) {
    try {
        // Look for "View Public Entries" link/button
        const btnHandle = await targetPage.evaluateHandle(() => {
            const elements = Array.from(document.querySelectorAll('a, button, div[role="button"], span.v-btn__content'));
            return elements.find(el => el.textContent.trim().includes('View Public Entries') || el.textContent.trim().includes('Public Entries'));
        });

        if (btnHandle.asElement()) {
            // Find the clicking target (if span, go up to button)
            let target = btnHandle.asElement();
            // Just clicking the element found usually works if it's the text span inside button
            return target;
        }
        return null;
    } catch (e) {
        return null;
    }
}


async function findAndClickEntryButton(rowIndex) {
    try {
        const meetRows = await page.$$('.row.no-gutters.align-center');
        if (!meetRows[rowIndex]) return null;

        const row = meetRows[rowIndex];

        // Look for "Entry List" or "Enter Now" button
        const btnHandle = await page.evaluateHandle((r) => {
            // Priority 1: Specific class from user feedback
            const primaryBtn = r.querySelector('button.s80-btn.primary');
            if (primaryBtn && primaryBtn.textContent.includes('Enter Now')) {
                return primaryBtn;
            }

            // Priority 2: Generic search
            const elements = Array.from(r.querySelectorAll('button, a, div[role="button"]'));
            return elements.find(el => {
                const txt = el.textContent.trim();
                return txt.includes('Entry List') || txt.includes('Enter Now') || txt.includes('View');
            });
        }, row);

        if (btnHandle.asElement()) {
            log(`  🖱️ Clicked Access button for meet ${rowIndex + 1}...`);
            const newTargetPromise = browser.waitForTarget(target => target.opener() === page.target());
            await btnHandle.asElement().click();
            const newTarget = await newTargetPromise;
            const newPage = await newTarget.page();
            await newPage.setViewport({ width: 1280, height: 800 });

            // Wait for network idle or reasonable content
            try {
                await newPage.waitForNetworkIdle({ timeout: 10000 });
            } catch (e) {
                // Continue if timeout, page might just be slow or have persistent polling
            }

            return newPage;
        }
        return null;

    } catch (e) {
        log(`  ⚠️ Could not click Entry List button: ${e.message}`);
        return null;
    }
}

function parseNameAndPronouns(rawStr) {
    if (!rawStr) return { name: null, pronouns: null };
    const match = rawStr.match(/^(.+?)\s*\((.+)\)$/);
    if (match) {
        return { name: match[1].trim(), pronouns: match[2].trim() };
    }
    return { name: rawStr.trim(), pronouns: null };
}

async function scrapeEntriesFromPage(targetPage) {
    try {
        await targetPage.waitForSelector('table tbody tr', { timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
        log('  ⚠️ No entries table found on entry page.');
        return [];
    }

    let allEntries = [];
    let currentPage = 1;
    let hasNextPage = true;

    // Loop until next button disabled
    while (hasNextPage) {
        log(`    Page ${currentPage}...`);

        const pageEntries = await targetPage.evaluate(() => {
            const entries = [];
            const rows = document.querySelectorAll('table tbody tr');

            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length < 5) continue;

                const txt = (idx) => cells[idx]?.textContent?.trim() || null;
                const cleanInt = (val) => {
                    const parsed = parseInt(val);
                    return isNaN(parsed) ? null : parsed;
                };
                const cleanFloat = (val) => {
                    const parsed = parseFloat(val);
                    return isNaN(parsed) ? null : parsed;
                };

                const entry = {
                    member_id: txt(0),
                    first_name: txt(1),
                    last_name: txt(2),
                    state: txt(3),
                    birth_year: cleanInt(txt(4)),
                    weightlifting_age: cleanInt(txt(5)),
                    club: txt(6),
                    gender: txt(7),
                    division: txt(8),
                    weight_class: txt(9),
                    entry_total: cleanFloat(txt(10))
                };

                if (entry.member_id && entry.first_name) {
                    entries.push(entry);
                }
            }
            return entries;
        });

        if (pageEntries.length > 0) {
            allEntries.push(...pageEntries);
        } else {
            // If a page is empty, maybe we reached the end or it's loading?
            // But valid pagination usually has data.
        }

        // Improved Next Button logic
        const clickedNext = await targetPage.evaluate(() => {
            // 1. Try standard Vuetify class
            let nextBtn = document.querySelector('.v-pagination__next:not(.v-pagination__next--disabled)');

            // 2. Try identifying by icon if class not found or matches disabled
            if (!nextBtn) {
                const icon = document.querySelector('.v-pagination__next .mdi-chevron-right, .mdi-chevron-right');
                if (icon) {
                    // Check if parent is disabled
                    const btnCandidate = icon.closest('button') || icon.closest('div[role="button"]') || icon.closest('.v-pagination__next');
                    if (btnCandidate) {
                        const isDisabled = btnCandidate.classList.contains('v-pagination__next--disabled') ||
                            btnCandidate.hasAttribute('disabled') ||
                            btnCandidate.getAttribute('aria-disabled') === 'true';
                        if (!isDisabled) {
                            nextBtn = btnCandidate;
                        }
                    }
                }
            }

            if (nextBtn) {
                nextBtn.click();
                return true;
            }
            return false;
        });

        if (clickedNext) {
            await new Promise(r => setTimeout(r, 4000)); // Wait for table refresh
            currentPage++;
        } else {
            hasNextPage = false;
        }
    }

    return allEntries;
}

// ------------- DATABASE LOGIC -------------

// Helper only for Date object creation if needed, no longer modifying meets table
function parseDateString(dateStr) {
    if (!dateStr) return null;
    const cleanStr = dateStr.replace(/(\d+)(st|nd|rd|th)/g, '$1');
    const date = new Date(cleanStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
}

// Extract start date from date range string
// e.g., "Mar 08-09, 2026" => "2026-03-08"
// e.g., "Mar 08, 2026" => "2026-03-08"
function parseStartDateFromRange(dateRange) {
    if (!dateRange) return null;

    // Try to extract just the first date part before any dash
    // "Mar 08-09, 2026" => "Mar 08, 2026"
    const parts = dateRange.split('-');
    if (parts.length > 1) {
        // Multi-day event: extract month, first day, and year
        const match = dateRange.match(/([A-Za-z]+)\s+(\d+)(?:-\d+)?,\s+(\d{4})/);
        if (match) {
            const [, month, day, year] = match;
            return parseDateString(`${month} ${day}, ${year}`);
        }
    }

    // Single day event or couldn't parse range: parse as-is
    return parseDateString(dateRange);
}

async function findMeet(meetData) {
    const { meet_name, date_range } = meetData;

    // Extract start date from the date range
    const startDate = parseStartDateFromRange(date_range);

    // Only match if we have both name AND date
    // This prevents incorrect matches between different years of the same meet
    if (!startDate) {
        // Cannot match without a valid date
        return null;
    }

    // Try exact match on name AND date
    let { data } = await supabase
        .from('meets')
        .select('meet_id, Meet, Date')
        .eq('Meet', meet_name)
        .eq('Date', startDate)
        .limit(1);

    if (data && data.length > 0) {
        return data[0];
    }

    // No match found - return null (will be saved as unmatched)
    return null;
}

// Upsert meet listing to usaw_meet_listings table
// This captures Sport80 announcements, whether matched to usaw_meets or not
async function upsertMeetListing(meetData, meetDetails, matchedMeetId = null) {
    const { meet_name, date_range } = meetData;
    // const eventDate = parseStartDateFromRange(date_range);  // No longer needed - using date_range directly

    if (!date_range) {
        log(`  ⚠️ Cannot create listing without valid event_date for "${meet_name}"`);
        return null;
    }

    const listingData = {
        meet_name,
        event_date: date_range,  // Store full date range as TEXT
        meet_type: meetDetails.meetType || null,
        address: meetDetails.address || null,
        organizer: meetDetails.organizer || null,
        contact_phone: meetDetails.phone || null,  // Fixed: was meetDetails.contactPhone
        contact_email: meetDetails.email || null,  // Fixed: was meetDetails.contactEmail
        registration_open: meetDetails.registrationOpen || null,
        registration_close: meetDetails.registrationClose || null,
        entries_on_platform: meetDetails.entriesOnPlatform || null,
        meet_id: matchedMeetId,
        meet_match_status: matchedMeetId ? 'matched' : 'unmatched', // Added meet_match_status
        last_seen_at: new Date().toISOString()
    };

    // Upsert: insert if new, update last_seen_at if exists
    const { data, error } = await supabase
        .from('usaw_meet_listings')
        .upsert(listingData, {
            onConflict: 'meet_name,event_date',
            ignoreDuplicates: false
        })
        .select('listing_id, meet_id')
        .single();

    if (error) {
        log(`  ❌ Failed to upsert listing for "${meet_name}": ${error.message}`);
        return null;
    }

    return data;
}

// Update has_entry_list status for a listing
async function updateListingEntryStatus(listingId, hasEntryList) {
    if (!listingId) return;

    await supabase.from('usaw_meet_listings').update({
        has_entry_list: hasEntryList,
        last_scraped_at: new Date().toISOString()
    }).eq('listing_id', listingId);
}

async function updateMeetEntryStatus(meetId, hasEntryList) {
    if (!meetId) return; // Can't update if no ID

    await supabase.from('usaw_meets').update({
        has_entry_list: hasEntryList,
        entry_list_last_scraped_at: new Date().toISOString()
    }).eq('meet_id', meetId);
}

async function processEntries(meetId, meetName, entries, eventDate, meetDetails = {}, listingId = null) {
    const chunkSize = 50;
    let stats = { newAthletes: 0, newEntries: 0, updatedEntries: 0, unchangedEntries: 0, failedEntries: 0 };

    for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);

        for (const entry of chunk) {
            try {
                const { name: lastName, pronouns } = parseNameAndPronouns(entry.last_name);

                // 1. Find or Create Lifter
                const fullName = `${entry.first_name} ${lastName}`;
                const lifterData = {
                    membership_number: entry.member_id,
                    ageCategory: entry.division,
                    weightClass: entry.weight_class
                };

                let matchStatus = 'matched';
                let lifterId = null;

                if (entry.member_id) {
                    const { data: memberParams } = await supabase
                        .from('usaw_lifters')
                        .select('lifter_id')
                        .eq('membership_number', entry.member_id)
                        .limit(1);

                    if (memberParams && memberParams.length > 0) {
                        lifterId = memberParams[0].lifter_id;
                        matchStatus = 'matched';
                    }
                }

                if (!lifterId) {
                    const { result } = await findOrCreateLifterEnhanced(supabase, fullName, { ...lifterData, createIfNeeded: false });
                    lifterId = result.lifter_id;

                    if (lifterId) {
                        matchStatus = 'matched';
                    } else {
                        matchStatus = 'unmatched';
                    }
                }

                // 2. Upsert Entry

                const entryRecord = {
                    listing_id: listingId,
                    event_date: eventDate,
                    lifter_id: lifterId,
                    meet_name: meetName,
                    membership_number: entry.member_id,
                    first_name: entry.first_name,
                    last_name: lastName,
                    pronouns: pronouns,
                    state: entry.state,
                    wso: getWSOFromState(entry.state),
                    birth_year: entry.birth_year,
                    weightlifting_age: entry.weightlifting_age,
                    club: entry.club,
                    gender: entry.gender,
                    division: entry.division,
                    weight_class: entry.weight_class,
                    entry_total: entry.entry_total,
                    athlete_match_status: matchStatus,
                    updated_at: new Date().toISOString()
                };

                // Check for existing record using listing_id + membership_number
                let existingRecord = null;

                if (listingId) {
                    const { data } = await supabase
                        .from('usaw_meet_entries')
                        .select('id, created_at')
                        .eq('listing_id', listingId)
                        .eq('membership_number', entry.member_id)
                        .maybeSingle();
                    existingRecord = data;
                }

                let upsertData = null;
                let error = null;

                let hasChanges = false; // Default to false

                if (existingRecord) {
                    // Fetch full existing record to compare
                    const { data: existingFull } = await supabase
                        .from('usaw_meet_entries')
                        .select('*')
                        .eq('id', existingRecord.id)
                        .single();

                    // Check if any field actually changed
                    const fieldsToCheck = [
                        'first_name', 'last_name', 'state', 'wso', 'birth_year',
                        'weightlifting_age', 'club', 'gender', 'division',
                        'weight_class', 'entry_total', 'athlete_match_status'
                    ];

                    hasChanges = fieldsToCheck.some(field => {
                        const oldVal = existingFull?.[field];
                        const newVal = entryRecord[field];
                        // Handle null/undefined equivalence
                        if (oldVal == null && newVal == null) return false;
                        return oldVal !== newVal;
                    });

                    if (hasChanges) {
                        // Only update if data actually changed
                        const { data: updateData, error: updateError } = await supabase
                            .from('usaw_meet_entries')
                            .update(entryRecord)
                            .eq('id', existingRecord.id)
                            .select('created_at, updated_at')
                            .single();
                        upsertData = updateData;
                        error = updateError;
                    } else {
                        // No changes, skip UPDATE
                        // Don't set upsertData - we'll skip the new/updated check below
                        stats.unchangedEntries = (stats.unchangedEntries || 0) + 1;
                    }
                } else {
                    // Insert new record
                    const { data: insertData, error: insertError } = await supabase
                        .from('usaw_meet_entries')
                        .insert(entryRecord)
                        .select('created_at, updated_at')
                        .single();
                    upsertData = insertData;
                    error = insertError;
                }

                if (!error && upsertData) {
                    // Check if this was an INSERT or UPDATE
                    const created = new Date(upsertData.created_at);
                    const now = new Date();
                    const secondsDiff = (now - created) / 1000;

                    if (secondsDiff < 10) {
                        stats.newEntries++;
                    } else {
                        stats.updatedEntries++;
                    }
                } else if (!hasChanges && existingRecord) {
                    // This was skipped intentionally - don't log error
                    // stats.unchangedEntries was already incremented above
                } else {
                    stats.failedEntries++;
                    log(`    ❌ Upsert failed for ${fullName}: ${error?.message || 'Unknown error'}`);
                }

            } catch (e) {
                stats.failedEntries++;
                log(`    ❌ Error processing entry for '${entry.first_name}': ${e.message}`);
            }
        }
    }

    return stats;
}

// ------------- MAIN -------------

function showHelp() {
    console.log(`
USAW Meet Entry Scraper
========================

Scrapes upcoming meet entries from Sport80 and stores them in the database.

USAGE:
  node meet-entry-scraper-db.js [OPTIONS]

OPTIONS:
  --from YYYY-MM-DD          Start date for scraping
  --to YYYY-MM-DD            End date for scraping
  --days N                   Scrape from today to N days ahead
  --year YYYY                Scrape entire year (Jan 1 - Dec 31)
  --headless                 Run browser in headless mode (default: true)
  --help                     Show this help message

EXAMPLES:
  # Scrape specific date range
  node meet-entry-scraper-db.js --from 2026-03-01 --to 2026-03-31

  # Scrape next 7 days
  node meet-entry-scraper-db.js --days 7

  # Scrape entire year
  node meet-entry-scraper-db.js --year 2026

  # Default: today to 120 days ahead
  node meet-entry-scraper-db.js

ENVIRONMENT VARIABLES:
  SUPABASE_URL               Supabase project URL (required)
  SUPABASE_SECRET_KEY        Supabase secret key (required)
    `);
    process.exit(0);
}

async function run() {
    const args = process.argv.slice(2);

    // Show help if requested
    if (args.includes('--help') || args.includes('-h')) {
        showHelp();
    }

    let fromDate, toDate;

    // Priority: --from/--to > --year > --days > default
    if (args.includes('--from') && args.includes('--to')) {
        fromDate = args[args.indexOf('--from') + 1];
        toDate = args[args.indexOf('--to') + 1];

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
            console.error('❌ Error: Dates must be in YYYY-MM-DD format');
            console.error('   Example: --from 2026-03-01 --to 2026-03-31');
            process.exit(1);
        }
    } else if (args.includes('--year')) {
        const y = args[args.indexOf('--year') + 1];
        fromDate = `${y}-01-01`;
        toDate = `${y}-12-31`;
    } else if (args.includes('--days')) {
        const d = parseInt(args[args.indexOf('--days') + 1]);
        const now = new Date();
        fromDate = now.toISOString().split('T')[0];
        const future = new Date(now);
        future.setDate(future.getDate() + d);
        toDate = future.toISOString().split('T')[0];
    } else {
        const now = new Date();
        fromDate = now.toISOString().split('T')[0];
        const future = new Date(now);
        future.setDate(future.getDate() + 120);
        toDate = future.toISOString().split('T')[0];
    }

    log(`Starting scrape for ${fromDate} to ${toDate}`);
    await initBrowser();

    try {
        const url = buildEventsURL(fromDate, toDate);
        log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        let hasNext = true;
        let pageNum = 1;

        while (hasNext) {
            log(`Processing directory page ${pageNum}...`);

            try {
                await page.waitForSelector('.row.no-gutters.align-center, .v-expansion-panel', { timeout: 15000 });
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                log('  ⚠️ No meets found (timeout).');
                break;
            }

            const meets = await scrapeMeetBasicInfo();
            log(`Found ${meets.length} meets.`);

            // Initialize batch stats if first run
            if (!global.scraperStats) {
                global.scraperStats = {
                    startDate: new Date().toISOString(),
                    meetsFound: 0,
                    meetsWithEntries: 0,
                    meetsSkipped: 0,
                    totalEntriesScraped: 0,
                    newEntriesAdded: 0,
                    entriesUpdated: 0,
                    entriesSkipped: 0,
                    dbErrors: 0,
                    unmatchedMeets: 0
                };
            }
            global.scraperStats.meetsFound += meets.length;

            for (let i = 0; i < meets.length; i++) {
                const m = meets[i];
                console.log('\n' + '='.repeat(80));
                log(`Check meet: ${m.meet_name} (${m.date_range})`);
                console.log('='.repeat(80) + '\n');

                // Read-Only check against usaw_meets
                const dbMeet = await findMeet(m);
                let meetId = null;

                if (dbMeet) {
                    log(`  ✅ Match found in DB: ID ${dbMeet.meet_id}`);
                    meetId = dbMeet.meet_id;
                } else {
                    log(`  ⚠️ No match in DB for "${m.meet_name}". Saving entries as unmatched.`);
                    global.scraperStats.unmatchedMeets++;
                    // Log to CSV for review
                    const logLine = `${new Date().toISOString()},"${m.meet_name}","${m.date_range}"\n`;
                    fs.appendFileSync('logs/unmatched_meets.csv', logLine);
                }

                // Scrape detailed meet info from expansion panel
                log(`  📋 Extracting meet details...`);
                const meetDetails = await scrapeDetailedMeetInfo(i);

                // Create or update meet listing (captures ALL meets, matched or not)
                const listing = await upsertMeetListing(m, meetDetails, meetId);

                if (!listing) {
                    log(`  ❌ Failed to create listing. Skipping entries.`);
                    global.scraperStats.dbErrors++;
                    continue;
                }

                const listingId = listing.listing_id;

                const entryPage = await findAndClickEntryButton(i);

                if (entryPage) {
                    // Scrape inner details (Description, etc.)
                    log(`  🔍 Checking for inner meet details...`);
                    const innerDetails = await scrapeInnerMeetDetails(entryPage);
                    if (innerDetails.description) {
                        log(`  Memo: Found description (${innerDetails.description.length} chars). Updating listing.`);
                        await supabase
                            .from('usaw_meet_listings')
                            .update({ meet_description: innerDetails.description })
                            .eq('listing_id', listingId);
                    }

                    // On the wizard page, we now need to find the "View Public Entries" button to proceed
                    const viewEntriesBtnHandle = await findEntryButtonOnWizard(entryPage);
                    let entries = [];

                    if (viewEntriesBtnHandle) {
                        log(`  🖱️ Clicked "View Public Entries"...`);

                        // Handle potential new tab/window opening
                        // Setup listener BEFORE clicking
                        const newTargetPromise = browser.waitForTarget(target => target.opener() === entryPage.target(), { timeout: 3000 }).catch(() => null);

                        // Click navigation button
                        await viewEntriesBtnHandle.click();

                        // Check if a new tab opened
                        const newTarget = await newTargetPromise;
                        let entriesPageToScrape = entryPage;

                        if (newTarget) {
                            log(`  Memo: "View Public Entries" opened a new tab. Switching context.`);
                            entriesPageToScrape = await newTarget.page();
                            await entriesPageToScrape.setViewport({ width: 1280, height: 800 });
                            await entriesPageToScrape.waitForNetworkIdle({ timeout: 10000 }).catch(() => { });
                        } else {
                            // If same page, just wait for network idle
                            await entryPage.waitForNetworkIdle({ timeout: 5000 }).catch(() => { });
                        }

                        // Wait for table on the correct page
                        try {
                            await entriesPageToScrape.waitForSelector('table tbody tr', { timeout: 15000 });
                            log(`  📄 Scraping entries...`);
                            entries = await scrapeEntriesFromPage(entriesPageToScrape);
                            log(`  Found ${entries.length} entries.`);

                            // Close new tab if we opened one to save memory
                            if (newTarget) {
                                await entriesPageToScrape.close();
                            }
                        } catch (e) {
                            log(`  ⚠️ Timed out waiting for entries table or error scraping: ${e.message}`);
                            // Fallback: Check if table is already there (maybe click failed or wasn't needed)
                            entries = await scrapeEntriesFromPage(entriesPageToScrape);
                            // Start closing logic for fallback too if needed
                            if (newTarget && !entriesPageToScrape.isClosed()) await entriesPageToScrape.close();
                        }
                    } else {
                        log(`  ⚠️ Could not find "View Public Entries" button on wizard page. Checking if we are already on list page...`);
                        // Fallback: Check if table is already there (some meets might skip wizard?)
                        entries = await scrapeEntriesFromPage(entryPage);
                    }

                    // Update both meet and listing entry status
                    if (meetId) {
                        await updateMeetEntryStatus(meetId, true);
                    }
                    if (listingId) {
                        await updateListingEntryStatus(listingId, true);
                    }

                    if (entries.length > 0) {
                        global.scraperStats.meetsWithEntries++;
                        global.scraperStats.totalEntriesScraped += entries.length;

                        const stats = await processEntries(meetId, m.meet_name, entries, m.date_range, meetDetails, listingId);
                        log(`  💾 Saved: ${stats.newEntries} new, ${stats.updatedEntries} updated, ${stats.unchangedEntries || 0} unchanged, ${stats.failedEntries} failed.`);

                        global.scraperStats.newEntriesAdded += stats.newEntries;
                        global.scraperStats.entriesUpdated += stats.updatedEntries;
                        global.scraperStats.entriesUnchanged = (global.scraperStats.entriesUnchanged || 0) + (stats.unchangedEntries || 0);
                        global.scraperStats.dbErrors += stats.failedEntries;
                        global.scraperStats.entriesSkipped += (entries.length - (stats.newEntries + stats.updatedEntries + (stats.unchangedEntries || 0) + stats.failedEntries));
                    } else {
                        // Entries found was 0
                        global.scraperStats.meetsSkipped++;
                    }

                    if (entryPage && !entryPage.isClosed()) {
                        await entryPage.close().catch(() => { });
                    }
                } else {
                    log(`  (No entry list button available)`);
                    global.scraperStats.meetsSkipped++;
                    // Update both meet and listing to reflect no entry list
                    if (meetId) {
                        await updateMeetEntryStatus(meetId, false);
                    }
                    if (listingId) {
                        await updateListingEntryStatus(listingId, false);
                    }
                }
            }


            log(`Checking for Next button (Page ${pageNum})...`);

            // Checks if next button exists and is not disabled
            const hasNextPageBtn = await page.evaluate(() => {
                // Method 1: Standard Vuetify class
                let btn = document.querySelector('.v-pagination__next');

                // Method 2: Find button with chevron-right icon (User feedback)
                if (!btn) {
                    const icon = document.querySelector('.mdi-chevron-right');
                    if (icon) {
                        btn = icon.closest('button') || icon.closest('div[role="button"]');
                    }
                }

                if (!btn) return false;

                // Check disabled state
                if (btn.classList.contains('v-pagination__next--disabled')) return false;
                if (btn.classList.contains('v-pagination__navigation--disabled')) return false; // Another common Vuetify disabled class
                if (btn.hasAttribute('disabled')) return false;
                if (btn.getAttribute('aria-disabled') === 'true') return false;

                return true;
            });

            if (hasNextPageBtn) {
                log(`  🖱️ Clicking Next button...`);
                await page.evaluate(() => {
                    // Try class click first
                    const btn = document.querySelector('.v-pagination__next');
                    if (btn) {
                        btn.click();
                    } else {
                        // Fallback to icon parent
                        const icon = document.querySelector('.mdi-chevron-right');
                        if (icon) {
                            const parent = icon.closest('button') || icon.closest('div[role="button"]');
                            if (parent) parent.click();
                        }
                    }
                });
                await new Promise(r => setTimeout(r, 4000)); // Generous wait
                pageNum++;
            } else {
                log(`  🛑 No more pages (Next button disabled or missing).`);
                hasNext = false;
            }
        }

        // Print Summary
        console.log('\n\n');
        console.log('################################################################################');
        console.log('#                                SCRAPER SUMMARY                               #');
        console.log('################################################################################');
        console.log(`Run Time:            ${new Date().toISOString()}`);
        console.log(`Meets Found:         ${global.scraperStats.meetsFound}`);
        console.log(`Meets w/ Entries:    ${global.scraperStats.meetsWithEntries}`);
        console.log(`Meets Skipped:       ${global.scraperStats.meetsSkipped}`);
        console.log('--------------------------------------------------------------------------------');
        console.log(`Total Entries Found: ${global.scraperStats.totalEntriesScraped}`);
        console.log(`New Entries Added:   ${global.scraperStats.newEntriesAdded}`);
        console.log(`Entries Updated:     ${global.scraperStats.entriesUpdated}`);
        console.log(`Entries Unchanged:   ${global.scraperStats.entriesUnchanged || 0}`);
        console.log(`Entries Failed/Skip: ${global.scraperStats.dbErrors + global.scraperStats.entriesSkipped}`);
        console.log('--------------------------------------------------------------------------------');
        console.log(`Unmatched Meets:     ${global.scraperStats.unmatchedMeets}`);
        console.log('################################################################################');

    } catch (e) {
        log(`Fatal error: ${e.message}`);
        console.error(e);
    } finally {
        await browser.close();
    }
}

run();
