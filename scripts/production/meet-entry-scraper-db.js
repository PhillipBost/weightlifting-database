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
const minimist = require('minimist');
const fs = require('fs');
const path = require('path');

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

let isDryRun = false;

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

async function initBrowser(headless = true) {
    log(`Initializing browser (headless: ${headless})...`);
    browser = await puppeteer.launch({
        headless: headless === true || headless === 'true',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
}

function buildEventsURL(fromDate, toDate) {
    // Use the Locator directory - more comprehensive than /public/events.
    // It includes developmental, club, and interclub meets that are hidden
    // from the main public events directory.
    return `https://usaweightlifting.sport80.com/pub/e_locator/meets/find?from_date=${fromDate}&to_date=${toDate}&sort=soonest`;
}

/**
 * Scrapes meet list from the Locator directory (e_locator/meets/find).
 * Reads the Inertia.js data-page JSON to get ALL meet metadata in one shot:
 * eid, name, date, GPS, address, organizer, registration windows, etc.
 * This is much faster and more complete than the old accordion-based approach.
 */
async function scrapeLocatorMeets() {
    return await page.evaluate(() => {
        const el = document.getElementById('app');
        if (!el) return [];
        try {
            const data = JSON.parse(el.getAttribute('data-page'));
            const meetsList = data.props && data.props.events;
            if (!Array.isArray(meetsList)) return [];

            // Month name -> number map for ISO date construction
            const monthMap = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

            const parseDateObj = (d) => {
                if (!d || !d.day || !d.month || !d.year) return null;
                const dayNum = parseInt(d.day, 10);
                const monthNum = monthMap[d.month]; // 0-indexed
                const yearNum = parseInt(d.year, 10);
                if (isNaN(dayNum) || monthNum === undefined || isNaN(yearNum)) return null;
                return { dayNum, monthNum, yearNum };
            };

            const toISODate = (parsed) => {
                if (!parsed) return null;
                return `${parsed.yearNum}-${String(parsed.monthNum + 1).padStart(2, '0')}-${String(parsed.dayNum).padStart(2, '0')}`;
            };

            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const toHuman = (parsed) => {
                if (!parsed) return null;
                const s = ['st','nd','rd'];
                const suffix = (d) => s[(d % 10) - 1] && d < 11 || d > 13 ? (s[(d % 10) - 1] || 'th') : 'th';
                return `${monthNames[parsed.monthNum]} ${parsed.dayNum}${suffix(parsed.dayNum)} ${parsed.yearNum}`;
            };

            return meetsList.map(m => {
                // Parse nested date object: { day, month, year, to_date: { day, month, year } }
                const startParsed = parseDateObj(m.date);
                const endParsed   = parseDateObj(m.date && m.date.to_date) || startParsed;

                const startISO  = toISODate(startParsed);
                const endISO    = toISODate(endParsed);
                const startHuman = toHuman(startParsed);
                const endHuman   = toHuman(endParsed);

                let dateRange = '';
                if (startHuman && endHuman) {
                    dateRange = startHuman === endHuman ? startHuman : `${startHuman} - ${endHuman}`;
                }

                return {
                    eid:                m.id || null,
                    meet_name:          m.name || null,
                    date_range:         dateRange,
                    start_date:         startISO,
                    end_date:           endISO,
                    location:           m.location || null,
                    latitude:           m.latitude || null,
                    longitude:          m.longitude || null,
                    organizer:          m.organiser_name || null,
                    contact_email:      m.organiser_email || null,
                    contact_phone:      m.organiser_phone || null,
                    entries_on_platform: m.entries_on_platform || false,
                    registration_open:  m.entry_open_timestamp || null,
                    registration_close: m.entry_close_timestamp || null,
                    has_entries:        m.has_entries || false,
                    meet_type:          m.meet_type || null,
                    entry_list_url:     m.entry_list_url || null,
                };
            });
        } catch (e) {
            return [];
        }
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
        // 1. Extract eid from the container
        const eid = await targetPage.evaluate(() => {
            const container = document.querySelector('.container--fluid[eid]');
            return container ? container.getAttribute('eid') : null;
        });

        let description = null;
        let locatorDetails = {};

        if (eid) {
            log(`    🔍 Found Sport80 eid: ${eid}. Fetching extended details from locator...`);
            locatorDetails = await scrapeLocatorDetails(eid);
            description = locatorDetails.description;
        }

        // 2. Fallback: try to find the information icon on the current page if locator failed or no eid
        if (!description) {
            await targetPage.waitForSelector('.s80-icon.mdi-information, .mdi-information', { timeout: 5000 }).catch(() => { });

            const infoResult = await targetPage.evaluate(async () => {
                let desc = '';
                const infoIcon = document.querySelector('.s80-icon.mdi-information, .mdi-information');

                if (infoIcon) {
                    const iconContainer = infoIcon.closest('.v-list-item__icon');
                    if (iconContainer) {
                        const contentContainer = iconContainer.nextElementSibling;
                        if (contentContainer && contentContainer.classList.contains('v-list-item__content')) {
                            const buttons = Array.from(contentContainer.querySelectorAll('button, .v-btn, [role="button"], span.text-padding'));
                            const showMoreBtn = buttons.find(b => b.textContent && b.textContent.toLowerCase().includes('show more'));

                            if (showMoreBtn) {
                                showMoreBtn.click();
                                await new Promise(r => setTimeout(r, 1500));
                            }

                            const dialogContent = document.querySelector('.dialog-card .dialog-content');
                            if (dialogContent) {
                                desc = dialogContent.innerText || dialogContent.textContent;
                                const closeBtn = document.querySelector('.dialog-card .close-button, .dialog-card button.close-button');
                                if (closeBtn) closeBtn.click();
                            } else {
                                desc = contentContainer.innerText || contentContainer.textContent;
                                desc = desc.replace(/Show more/gi, '').replace(/Show less/gi, '');
                            }
                        }
                    }
                }
                return desc;
            });
            description = infoResult;
        }

        return { 
            description, 
            eid,
            address: locatorDetails.address,
            latitude: locatorDetails.latitude,
            longitude: locatorDetails.longitude
        };
    } catch (e) {
        log(`  ⚠️ Failed to scrape inner details: ${e.message}`);
        return { description: null };
    }
}

/**
 * Scrapes the Sport80 locator view page for the meet description and coordinates
 */
async function scrapeLocatorDetails(eid) {
    let locatorPage = null;
    try {
        locatorPage = await browser.newPage();
        await locatorPage.setViewport({ width: 1280, height: 800 });
        const url = `https://usaweightlifting.sport80.com/pub/e_locator/meets/view/${eid}`;
        
        await locatorPage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for content
        await locatorPage.waitForSelector('.v-card, .v-list-item', { timeout: 10000 }).catch(() => {});

        const details = await locatorPage.evaluate(() => {
            const el = document.getElementById('app');
            if (!el) return {};
            
            try {
                const data = JSON.parse(el.getAttribute('data-page'));
                const event = data.props.event;
                const additionalInfo = data.props.additional_info || [];
                
                // 1. Extract description (from additional_info)
                let description = '';
                for (const info of additionalInfo) {
                    if (info.label === 'Information' || info.label === 'About') {
                        description = info.text || '';
                        break;
                    }
                }
                
                // Clean up HTML from description
                const cleanDescription = description
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>/gi, '\n')
                    .replace(/<[^>]*>/g, '')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/\n\s*\n/g, '\n')
                    .trim();

                return {
                    description: cleanDescription || null,
                    address: event.location || null,
                    latitude: event.latitude || null,
                    longitude: event.longitude || null
                };
            } catch (e) {
                return {};
            }
        });

        // 3. Fallback to iframe extraction if Inertia data is missing coordinates (unlikely but safe)
        if (!details.latitude || !details.longitude) {
            const coords = await extractCoordinatesFromLocator(locatorPage);
            if (coords) {
                details.latitude = coords.latitude;
                details.longitude = coords.longitude;
            }
        }

        return details;
    } catch (e) {
        log(`    ⚠️ Error scraping locator details for ${eid}: ${e.message}`);
        return {};
    } finally {
        if (locatorPage) await locatorPage.close();
    }
}

/**
 * Helper to extract GPS coordinates from Google Maps iframe on locator page
 */
async function extractCoordinatesFromLocator(page) {
    try {
        const iframeSrc = await page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="google.com/maps"]');
            return iframe ? iframe.src : null;
        });

        if (!iframeSrc) return null;

        // Parse from URL params or path
        const parseCoords = (url) => {
            // !2d longitude !3d latitude
            const lngMatch = url.match(/!2d(-?\d+\.\d+)/);
            const latMatch = url.match(/!3d(-?\d+\.\d+)/);
            if (lngMatch && latMatch) {
                return { latitude: parseFloat(latMatch[1]), longitude: parseFloat(lngMatch[1]) };
            }
            // @lat,lng
            const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (atMatch) {
                return { latitude: parseFloat(atMatch[1]), longitude: parseFloat(atMatch[2]) };
            }
            return null;
        };

        let coords = parseCoords(iframeSrc);
        if (coords) return coords;

        // Strategy 2: Find "View larger map" link
        const frames = page.frames();
        const mapFrame = frames.find(f => f.url().includes('google.com/maps'));
        if (mapFrame) {
            const mapUrl = await mapFrame.evaluate(() => {
                const link = document.querySelector('a[href*="maps.google.com"]');
                return link ? link.href : null;
            });
            if (mapUrl) return parseCoords(mapUrl);
        }

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Navigates to the locator view page for a given eid, finds the entry list
 * link, navigates to it, and returns the page.
 * This replaces findAndClickEntryButton which required a row index on the
 * old accordion-based /public/events page.
 */
async function navigateToLocatorForEntries(eid, entryListUrl = null) {
    let viewPage = null;
    try {
        // Fast path: if we already have the entry list URL from the search results JSON, use it directly
        if (entryListUrl) {
            log(`  🔗 Using entry_list_url from locator JSON: ${entryListUrl}`);
            viewPage = await browser.newPage();
            await viewPage.setViewport({ width: 1280, height: 800 });
            await viewPage.goto(entryListUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            return viewPage;
        }

        // Slow path: navigate to locator view page and extract the entry list link
        const locatorUrl = `https://usaweightlifting.sport80.com/pub/e_locator/meets/view/${eid}`;
        viewPage = await browser.newPage();
        await viewPage.setViewport({ width: 1280, height: 800 });
        log(`  📋 Navigating to locator view for eid ${eid}...`);
        await viewPage.goto(locatorUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Try to extract the entry list URL from data-page JSON first
        const foundUrl = await viewPage.evaluate(() => {
            try {
                const el = document.getElementById('app');
                if (!el) return null;
                const data = JSON.parse(el.getAttribute('data-page'));
                const props = data.props || {};
                if (props.entry_list_url) return props.entry_list_url;
                if (props.event && props.event.entry_list_url) return props.event.entry_list_url;
            } catch (e) { /* fall through */ }
            return null;
        });

        if (foundUrl) {
            log(`  🔗 Found entry list URL in data-page: ${foundUrl}`);
            await viewPage.goto(foundUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            return viewPage;
        }

        // Fallback: find Entry List link in DOM
        const entryLinkHandle = await viewPage.evaluateHandle(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.find(a => {
                const txt = (a.textContent || '').trim();
                return txt.includes('Entry List') || txt.includes('View Public Entries') || txt.includes('Public Entries');
            });
        });

        if (entryLinkHandle && entryLinkHandle.asElement()) {
            log(`  🔗 Found Entry List link in DOM, clicking...`);
            await Promise.all([
                viewPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
                entryLinkHandle.asElement().click()
            ]);
            return viewPage;
        }

        log(`  (No Entry List link found on locator view page for eid ${eid})`);
        await viewPage.close().catch(() => {});
        return null;
    } catch (e) {
        log(`  ⚠️ Could not navigate to entry list for eid ${eid}: ${e.message}`);
        if (viewPage) await viewPage.close().catch(() => {});
        return null;
    }
}


async function findEntryButtonOnWizard(targetPage) {
    try {
        // Look for "View Public Entries" link/button
        const btnHandle = await targetPage.evaluateHandle(() => {
            const elements = Array.from(document.querySelectorAll('a, button, div[role="button"], span.v-btn__content, span.text-padding'));
            return elements.find(el => {
                const txt = el.textContent.trim();
                return txt.includes('Entry List') || txt.includes('View Public Entries') || txt.includes('Public Entries');
            });
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
    let lastPageFingerprint = '';

    // Extract total records from header if available
    const totalRecords = await targetPage.evaluate(() => {
        const h2 = Array.from(document.querySelectorAll('h2')).find(el => el.textContent.includes('Records'));
        if (h2) {
            const match = h2.textContent.match(/(\d+)\s+Records/);
            return match ? parseInt(match[1]) : null;
        }
        // Fallback to footer
        const footer = document.querySelector('.v-data-footer__pagination');
        if (footer) {
            const match = footer.textContent.match(/of\s+(\d+)/);
            return match ? parseInt(match[1]) : null;
        }
        return null;
    });

    if (totalRecords) {
        log(`  📄 Found ${totalRecords} total records. Scraping pages...`);
    }

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
            // Check if we are stuck on the same page
            const currentFingerprint = pageEntries[0].member_id + pageEntries[pageEntries.length - 1].member_id;
            if (currentFingerprint === lastPageFingerprint) {
                log(`    ⚠️ Page content did not change. Stopping pagination to prevent loop.`);
                hasNextPage = false;
                break;
            }
            lastPageFingerprint = currentFingerprint;
            allEntries.push(...pageEntries);
        }

        // Improved Next Button logic
        const clickedNext = await targetPage.evaluate(() => {
            // 1. Try ARIA label (most robust for accessibility/Vuetify)
            let nextBtn = document.querySelector("button[aria-label='Next page']:not([disabled])");

            // 2. Try standard Vuetify class
            if (!nextBtn) {
                nextBtn = document.querySelector('.v-pagination__next:not(.v-pagination__next--disabled)');
            }

            // 3. Try identifying by icon
            if (!nextBtn) {
                const icon = document.querySelector('.v-pagination__next .mdi-chevron-right, .mdi-chevron-right');
                if (icon) {
                    const btnCandidate = icon.closest('button') || icon.closest('div[role="button"]');
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

// Helper to separate date from time/timezone junk
function cleanDatePart(str) {
    if (!str) return '';
    return str
        .replace(/\d{1,2}:\d{2}\s+(AM|PM)/gi, '') // Remove time
        .replace(/\([A-Z]+\)/g, '')               // Remove timezone
        .trim();
}

// Robust date parser (handles ranges, ordinals, etc.)
function parseDatesFromEventDate(eventDate) {
    if (!eventDate) return { start: null, end: null };

    const parts = eventDate.split(' - ');

    if (parts.length === 2) {
        // Range: "Start - End"
        const startRaw = cleanDatePart(parts[0]);
        const endRaw = cleanDatePart(parts[1]);

        const start = parseDateString(startRaw);
        const end = parseDateString(endRaw);

        return { start, end };
    }

    if (parts.length === 1) {
        // Single date
        const raw = cleanDatePart(parts[0]);
        const date = parseDateString(raw);
        if (date) {
            return { start: date, end: date }; // Single day event has same start/end
        }
    }

    return { start: null, end: null };
}

// COMPATIBILITY WRAPPER for existing findMeet usage
function parseStartDateFromRange(dateRange) {
    const { start } = parseDatesFromEventDate(dateRange);
    return start;
}

async function findMeet(meetData) {
    const { meet_name, date_range } = meetData;

    // Extract start and end dates from the date range
    const { start: startDate, end: endDate } = parseDatesFromEventDate(date_range);

    // Only match if we have both name AND date
    // This prevents incorrect matches between different years of the same meet
    if (!startDate || !endDate) {
        // Cannot match without a valid date
        return null;
    }

    // Try match on name AND date falling between start and end date
    let { data } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date')
        .eq('Meet', meet_name)
        .gte('Date', startDate)
        .lte('Date', endDate)
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


    // Parse start and end dates for sorting
    const { start, end } = parseDatesFromEventDate(date_range);

    // Parse granular address fields
    const { parseAddressIntelligently } = require('../geographic/fix-address-parsing');
    const parsedAddr = parseAddressIntelligently(meetDetails.address || meetData.location || '');

    const listingData = {
        meet_name,
        event_date: date_range,
        start_date: start,
        end_date: end,
        meet_type: meetDetails.meetType || null,
        address: meetDetails.address || null,
        street_address: parsedAddr.street_address || null,
        city: parsedAddr.city || null,
        state: parsedAddr.state || null,
        zip_code: parsedAddr.zip_code || null,
        country: parsedAddr.country || 'United States',
        meet_description: meetDetails.description || null,
        latitude: meetDetails.latitude || null,
        longitude: meetDetails.longitude || null,
        location_text: meetData.location || null,
        organizer: meetDetails.organizer || null,
        contact_phone: meetDetails.contact_phone || meetDetails.phone || null,
        contact_email: meetDetails.contact_email || meetDetails.email || null,
        registration_open: meetDetails.registration_open || meetDetails.registrationOpen || null,
        registration_close: meetDetails.registration_close || meetDetails.registrationClose || null,
        entries_on_platform: meetDetails.entries_on_platform ?? meetDetails.entriesOnPlatform ?? null,
        meet_id: matchedMeetId,
        meet_match_status: matchedMeetId ? 'matched' : 'unmatched',
        last_seen_at: new Date().toISOString()
    };

    // Check for existing record to provide clear logging
    const { data: existing } = await supabase
        .from('usaw_meet_listings')
        .select('listing_id')
        .eq('meet_name', meet_name)
        .eq('event_date', date_range)
        .maybeSingle();

    if (existing) {
        log(`  ✅ Match found in usaw_meet_listings (Scraper): ID ${existing.listing_id}`);
    } else {
        log(`  ➕ No existing listing found for "${meet_name}". Prepared to insert new record.`);
    }

    // Upsert: insert if new, update last_seen_at if exists
    let data = { listing_id: 'DRY-RUN-LISTING', meet_id: matchedMeetId };
    let error = null;

    if (isDryRun) {
        if (existing) {
            data.listing_id = existing.listing_id;
            log(`    [DRY RUN] Would UPDATE listing ${data.listing_id} for "${meet_name}"`);
        } else {
            log(`    [DRY RUN] Would INSERT NEW listing for "${meet_name}"`);
        }
        // Print a preview of what would be written
        const pad = (s) => String(s).padEnd(24);
        const preview = Object.entries(listingData)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `      ${pad(k)} ${v}`)
            .join('\n');
        log(`    [DRY RUN] Listing data preview:\n${preview}`);
    } else {
        const { data: upsertData, error: upsertError } = await supabase
            .from('usaw_meet_listings')
            .upsert(listingData, {
                onConflict: 'meet_name,event_date',
                ignoreDuplicates: false
            })
            .select('listing_id, meet_id')
            .single();
        data = upsertData;
        error = upsertError;
    }

    if (error) {
        log(`  ❌ Failed to upsert listing for "${meet_name}": ${error.message}`);
        return null;
    }

    return data;
}

// Update has_entry_list status for a listing
async function updateListingEntryStatus(listingId, hasEntryList) {
    if (!listingId) return;

    if (isDryRun) {
        log(`    [DRY RUN] Would update listing entry status for ID ${listingId}`);
        return;
    }

    await supabase.from('usaw_meet_listings').update({
        has_entry_list: hasEntryList,
        last_scraped_at: new Date().toISOString()
    }).eq('listing_id', listingId);
}

async function updateMeetEntryStatus(meetId, hasEntryList) {
    if (!meetId) return; // Can't update if no ID

    if (isDryRun) {
        log(`    [DRY RUN] Would update meet entry status for ID ${meetId}`);
        return;
    }

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
                log(`  ➡️ Processing: ${fullName} (ID: ${entry.member_id || 'N/A'})`);
                
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
                    const { result } = await findOrCreateLifterEnhanced(supabase, fullName, { 
                        ...lifterData, 
                        createIfNeeded: false,
                        dryRun: isDryRun 
                    });
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
                        if (isDryRun) {
                            log(`    [DRY RUN] Would update entry for ${fullName}`);
                            upsertData = { created_at: '2000-01-01', updated_at: new Date().toISOString() };
                        } else {
                            const { data: updateData, error: updateError } = await supabase
                                .from('usaw_meet_entries')
                                .update(entryRecord)
                                .eq('id', existingRecord.id)
                                .select('created_at, updated_at')
                                .single();
                            upsertData = updateData;
                            error = updateError;
                        }
                    } else {
                        // No changes, skip UPDATE
                        stats.unchangedEntries = (stats.unchangedEntries || 0) + 1;
                    }
                } else {
                    // Insert new record
                    if (isDryRun) {
                        log(`    [DRY RUN] Would insert entry for ${fullName}`);
                        upsertData = { created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
                    } else {
                        const { data: insertData, error: insertError } = await supabase
                            .from('usaw_meet_entries')
                            .insert(entryRecord)
                            .select('created_at, updated_at')
                            .single();
                        upsertData = insertData;
                        error = insertError;
                    }
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
                    const msg = `Upsert failed for ${fullName}: ${error?.message || 'Unknown error'}`;
                    log(`    ❌ ${msg}`);
                    try {
                        fs.appendFileSync('logs/failed_entries.csv', `${new Date().toISOString()},"${meetName}","${fullName}","${error?.message || 'Unknown error'}"\n`);
                    } catch (err) { /* ignore log write error */ }
                }

            } catch (e) {
                stats.failedEntries++;
                log(`    ❌ Error processing entry for '${entry.first_name}': ${e.message}`);
                try {
                    fs.appendFileSync('logs/failed_entries.csv', `${new Date().toISOString()},"${meetName}","${entry.first_name} ${entry.last_name}","${e.message}"\n`);
                } catch (err) { /* ignore log write error */ }
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
  --dry-run                  Run without writing to the database
  --meta-only                Only scrape meet details/locations, skip entries
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
    const argv = minimist(process.argv.slice(2), {
        string: ['from', 'to', 'year', 'days'],
        boolean: ['headless', 'dry-run', 'meta-only', 'help'],
        alias: { h: 'help', d: 'dry-run', m: 'meta-only' },
        default: { headless: true }
    });

    // Show help if requested
    if (argv.help) {
        showHelp();
    }

    if (argv['dry-run']) {
        isDryRun = true;
        log('🛡️ DRY RUN MODE ENABLED. No database writes will occur.');
    }

    let fromDate = argv.from;
    let toDate = argv.to;
    let days = argv.days;
    let year = argv.year;
    const headless = argv.headless;

    // Fallback: If no flags but we have positional arguments that look like dates
    if (!fromDate && !toDate && !days && !year && argv._.length >= 2) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(argv._[0]) && /^\d{4}-\d{2}-\d{2}$/.test(argv._[1])) {
            fromDate = argv._[0];
            toDate = argv._[1];
            log(`📅 Detected positional dates: ${fromDate} to ${toDate}`);
        }
    }

    if (fromDate && toDate) {
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
            console.error('❌ Error: Dates must be in YYYY-MM-DD format');
            console.error('   Example: --from 2026-03-01 --to 2026-03-31');
            process.exit(1);
        }
    } else if (year) {
        fromDate = `${year}-01-01`;
        toDate = `${year}-12-31`;
    } else if (days) {
        const d = parseInt(days);
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

    log(`🚀 Starting scrape from ${fromDate} to ${toDate}`);
    await initBrowser(headless);

    try {
        const url = buildEventsURL(fromDate, toDate);
        log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        let hasNext = true;
        let pageNum = 1;

        while (hasNext) {
            log(`Processing directory page ${pageNum}...`);

            try {
                // Locator uses card-based layout, not accordion
                await page.waitForSelector('#app[data-page]', { timeout: 15000 });
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                log('  ⚠️ No meets found (timeout).');
                break;
            }

            const meets = await scrapeLocatorMeets();
            log(`Found ${meets.length} meets.`);

            // Initialize batch stats if first run
            if (!global.scraperStats) {
                global.scraperStats = {
                    startDate: new Date().toISOString(),
                    meetsFound: 0,
                    meetsWithEntries: 0,
                    meetsSkipped: 0,
                    metaOnlyMeets: 0,
                    totalEntriesScraped: 0,
                    newEntriesAdded: 0,
                    entriesUpdated: 0,
                    entriesSkipped: 0,
                    dbErrors: 0,
                    unmatchedMeets: 0,
                    failedMeets: [], // Track meets with errors for summary
                    skippedMeetsDetails: [] // Track meets that were skipped (no access)
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
                    log(`  ✅ Match found in usaw_meets (Results): ID ${dbMeet.meet_id}`);
                    meetId = dbMeet.meet_id;
                } else {
                    log(`  ⚠️ No match in usaw_meets for "${m.meet_name}". Saving as unmatched.`);
                    global.scraperStats.unmatchedMeets++;
                    // Log to CSV for review
                    const logLine = `${new Date().toISOString()},"${m.meet_name}","${m.date_range}"\n`;
                    fs.appendFileSync('logs/unmatched_meets.csv', logLine);
                }

                // Build meetDetails from locator JSON - already have GPS, organizer, etc.
                // No need for accordion expansion click (scrapeDetailedMeetInfo) anymore.
                log(`  📋 Meet details from locator JSON (eid: ${m.eid || 'N/A'})`);
                const meetDetails = {
                    address:          m.location || null,
                    organizer:        m.organizer || null,
                    email:            m.contact_email || null,
                    phone:            m.contact_phone || null,
                    meetType:         m.meet_type || null,
                    latitude:         m.latitude || null,
                    longitude:        m.longitude || null,
                    entriesOnPlatform: m.entries_on_platform || false,
                    registrationOpen: m.registration_open || null,
                    registrationClose: m.registration_close || null,
                    description:      null // fetched below from locator view if needed
                };

                // Fetch full description from locator view page (if we have an eid)
                if (m.eid) {
                    const locDetails = await scrapeLocatorDetails(m.eid);
                    if (locDetails.description) meetDetails.description = locDetails.description;
                    // Override GPS with locator view data if missing from search results
                    if (!meetDetails.latitude && locDetails.latitude) meetDetails.latitude = locDetails.latitude;
                    if (!meetDetails.longitude && locDetails.longitude) meetDetails.longitude = locDetails.longitude;
                    if (!meetDetails.address && locDetails.address) meetDetails.address = locDetails.address;
                }

                // Create or update meet listing (captures ALL meets, matched or not)
                const listing = await upsertMeetListing(m, meetDetails, meetId);

                if (!listing) {
                    log(`  ❌ Failed to create listing. Skipping entries.`);
                    global.scraperStats.dbErrors++;
                    continue;
                }

                const listingId = listing.listing_id;

                // Navigate to entry list — use entry_list_url from locator JSON if available
                const entryPage = m.eid ? await navigateToLocatorForEntries(m.eid, m.entry_list_url) : null;

                if (entryPage) {
                    if (argv['meta-only']) {
                        log(`  \u23ed\ufe0f --meta-only flag set. Skipping entry scraping for "${m.meet_name}".`);
                        global.scraperStats.metaOnlyMeets++;
                        if (entryPage && !entryPage.isClosed()) await entryPage.close().catch(() => { });
                        continue;
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
                        log(`  🔍 Initial button not found on wizard, checking if entry list is already visible...`);
                        // Fallback: Check if table is already there (some meets might skip wizard or are direct-link)
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

                        if (stats.failedEntries > 0) {
                            global.scraperStats.failedMeets.push({
                                name: m.meet_name,
                                date: m.date_range,
                                failures: stats.failedEntries
                            });
                        }
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
                    global.scraperStats.skippedMeetsDetails.push({
                        name: m.meet_name,
                        reason: 'No Access/Entry List button available'
                    });
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
        console.log(`Meets (Meta Only):   ${global.scraperStats.metaOnlyMeets}`);
        console.log(`Meets Skipped:       ${global.scraperStats.meetsSkipped}`);
        console.log('--------------------------------------------------------------------------------');
        console.log(`Total Entries Found: ${global.scraperStats.totalEntriesScraped}`);
        console.log(`New Entries Added:   ${global.scraperStats.newEntriesAdded}`);
        console.log(`Entries Updated:     ${global.scraperStats.entriesUpdated}`);
        console.log(`Entries Unchanged:   ${global.scraperStats.entriesUnchanged || 0}`);
        console.log(`Entries Failed/Skip: ${global.scraperStats.dbErrors + global.scraperStats.entriesSkipped}`);
        console.log('--------------------------------------------------------------------------------');
        console.log(`Unmatched (Master):  ${global.scraperStats.unmatchedMeets}`);
        console.log('--------------------------------------------------------------------------------');

        if (global.scraperStats.failedMeets && global.scraperStats.failedMeets.length > 0) {
            console.log('\nMEETS WITH FAILURES:');
            console.log('--------------------------------------------------------------------------------');
            global.scraperStats.failedMeets.forEach(m => {
                console.log(`- ${m.name}: ${m.failures} errors`);
            });
        }

        if (global.scraperStats.skippedMeetsDetails && global.scraperStats.skippedMeetsDetails.length > 0) {
            console.log('\nMEETS SKIPPED (No inner details available):');
            console.log('--------------------------------------------------------------------------------');
            global.scraperStats.skippedMeetsDetails.forEach(m => {
                console.log(`- ${m.name}: ${m.reason}`);
            });
        }

        console.log('See logs/failed_entries.csv for individual error details.');
        console.log('################################################################################');

    } catch (e) {
        log(`Fatal error: ${e.message}`);
        console.error(e);
    } finally {
        await browser.close();
    }
}

run();
