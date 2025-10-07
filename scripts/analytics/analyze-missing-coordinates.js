/**
 * Analyze Missing Coordinates in Meets
 * 
 * Identifies meets that are missing coordinates and would be excluded
 * from WSO analytics calculations.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function log(message) {
    console.log(message);
}

async function analyzeMissingCoordinates() {
    log('=== Analyze Missing Coordinates in Meets ===\n');
    
    const currentDate = new Date();
    const oneYearAgo = new Date(currentDate);
    oneYearAgo.setFullYear(currentDate.getFullYear() - 1);
    const cutoffDateString = oneYearAgo.toISOString().split('T')[0];
    
    log(`Analyzing meets since ${cutoffDateString}\n`);
    
    // Get all recent meets
    const { data: allMeets, error } = await supabase
        .from('meets')
        .select('meet_id, Meet, Date, address, latitude, longitude, wso_geography')
        .gte('Date', cutoffDateString)
        .order('Date', { ascending: false });
    
    if (error) {
        log(`❌ Error: ${error.message}`);
        return;
    }
    
    log(`📊 Total recent meets: ${allMeets.length}`);
    
    // Categorize meets
    const withCoords = allMeets.filter(m => m.latitude && m.longitude);
    const withoutCoords = allMeets.filter(m => !m.latitude || !m.longitude);
    const withAddress = withoutCoords.filter(m => m.address);
    const withoutAddress = withoutCoords.filter(m => !m.address);
    
    log(`✅ With coordinates: ${withCoords.length} (${Math.round(withCoords.length/allMeets.length*100)}%)`);
    log(`❌ Without coordinates: ${withoutCoords.length} (${Math.round(withoutCoords.length/allMeets.length*100)}%)`);
    log(`   - Have address (can be geocoded): ${withAddress.length}`);
    log(`   - Missing address (cannot be geocoded): ${withoutAddress.length}`);
    
    // Check Alabama specifically
    const alabamaMeets = allMeets.filter(m => 
        m.wso_geography === 'Alabama' || 
        (m.address && (m.address.includes('Alabama') || m.address.includes(', AL')))
    );
    
    const alabamaWithCoords = alabamaMeets.filter(m => m.latitude && m.longitude);
    const alabamaWithoutCoords = alabamaMeets.filter(m => !m.latitude || !m.longitude);
    
    log(`\n📍 Alabama Meets:`);
    log(`   Total: ${alabamaMeets.length}`);
    log(`   With coordinates: ${alabamaWithCoords.length} (${Math.round(alabamaWithCoords.length/alabamaMeets.length*100)}%)`);
    log(`   WITHOUT coordinates: ${alabamaWithoutCoords.length} (${Math.round(alabamaWithoutCoords.length/alabamaMeets.length*100)}%)`);
    
    if (alabamaWithoutCoords.length > 0) {
        log(`\n❌ Alabama meets WITHOUT coordinates (excluded from analytics):`);
        alabamaWithoutCoords.forEach(meet => {
            log(`   - ${meet.Meet} (${meet.Date})`);
            log(`     Address: ${meet.address || 'MISSING'}`);
        });
    }
    
    // Group by WSO to see which WSOs are most affected
    log(`\n=== Missing Coordinates by WSO ===\n`);
    
    const wsoStats = {};
    
    allMeets.forEach(meet => {
        const wso = meet.wso_geography || 'Unknown';
        if (!wsoStats[wso]) {
            wsoStats[wso] = { total: 0, withCoords: 0, withoutCoords: 0 };
        }
        wsoStats[wso].total++;
        if (meet.latitude && meet.longitude) {
            wsoStats[wso].withCoords++;
        } else {
            wsoStats[wso].withoutCoords++;
        }
    });
    
    const sortedWSOs = Object.entries(wsoStats)
        .sort((a, b) => b[1].withoutCoords - a[1].withoutCoords)
        .slice(0, 15);
    
    log('Top 15 WSOs with missing coordinates:\n');
    sortedWSOs.forEach(([wso, stats]) => {
        const missingPct = Math.round(stats.withoutCoords / stats.total * 100);
        log(`${wso.padEnd(30)} ${stats.withoutCoords}/${stats.total} missing (${missingPct}%)`);
    });
    
    log(`\n=== SUMMARY ===\n`);
    log(`⚠️  CRITICAL FINDING:`);
    log(`   ${withoutCoords.length} out of ${allMeets.length} recent meets (${Math.round(withoutCoords.length/allMeets.length*100)}%) are missing coordinates`);
    log(`   These meets are EXCLUDED from all WSO analytics calculations!`);
    log(`\n   This affects:`);
    log(`   - active_lifters_count`);
    log(`   - recent_meets_count`);
    log(`   - total_participations`);
    log(`   - barbell_clubs_count (indirectly)`);
    
    if (withAddress.length > 0) {
        log(`\n🔧 SOLUTION:`);
        log(`   ${withAddress.length} meets have addresses and can be geocoded`);
        log(`   Run the geocoding script to populate coordinates:`);
        log(`   node scripts/geographic/geocode-and-import.js`);
    }
    
    if (withoutAddress.length > 0) {
        log(`\n⚠️  ${withoutAddress.length} meets have NO address - cannot be geocoded`);
        log(`   These require manual data entry or address scraping`);
    }
    
    log(`\n📊 Expected impact after geocoding:`);
    log(`   Alabama active_lifters_count would increase from 0 to ~${Math.round(alabamaWithoutCoords.length * 15)} lifters`);
    log(`   (assuming ~15 participants per meet on average)`);
}

async function main() {
    try {
        await analyzeMissingCoordinates();
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { analyzeMissingCoordinates };
