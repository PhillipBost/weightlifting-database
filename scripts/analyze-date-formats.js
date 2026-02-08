const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function analyzeEventDates() {
    console.log('🔍 Analyzing all event_date formats in usaw_meet_listings...\n');

    // Fetch all listings
    const { data, error } = await supabase
        .from('usaw_meet_listings')
        .select('event_date')
        .not('event_date', 'is', null);

    if (error) {
        console.error('❌ Error fetching data:', error);
        return;
    }

    console.log(`Pocessing ${data.length} records...`);

    const patterns = {
        'Month DD, YYYY': /^[A-Za-z]+\s+\d{1,2},\s+\d{4}$/, // "June 11, 2022"
        'Month DD-DD, YYYY': /^[A-Za-z]+\s+\d{1,2}-\d{1,2},\s+\d{4}$/, // "June 11-12, 2022"
        'Date Range with Month Change': /^[A-Za-z]+\s+\d{1,2}\s+-\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}$/, // "Dec 31 - Jan 1, 2023" (approx)
        'Ordinal Date': /^[A-Za-z]+\s+\d{1,2}(st|nd|rd|th)\s+\d{4}$/, // "June 11th 2022" 
        'ISO Date': /^\d{4}-\d{2}-\d{2}$/,
    };

    const stats = {
        total: data.length,
        matched: 0,
        unmatched: 0,
        byPattern: {},
        unmatchedSamples: new Set()
    };

    // Initialize counts
    Object.keys(patterns).forEach(k => stats.byPattern[k] = 0);

    data.forEach(row => {
        const dateStr = row.event_date.trim();
        let isMatched = false;

        for (const [name, regex] of Object.entries(patterns)) {
            if (regex.test(dateStr)) {
                stats.byPattern[name]++;
                isMatched = true;
                break;
            }
        }

        if (!isMatched) {
            // Try to loosely categorize leftovers
            if (dateStr.includes('-')) {
                if (!stats.byPattern['Other Range']) stats.byPattern['Other Range'] = 0;
                stats.byPattern['Other Range']++;
            } else {
                if (!stats.byPattern['Other format']) stats.byPattern['Other format'] = 0;
                stats.byPattern['Other format']++;
            }
            stats.unmatched++;
            if (stats.unmatchedSamples.size < 100) {
                stats.unmatchedSamples.add(dateStr);
            }
        } else {
            stats.matched++;
        }
    });

    const fs = require('fs');
    const report = [];

    report.push('📊 Analysis Results:');
    report.push(`Total Records: ${stats.total}`);
    // ... (rest of stats)

    Object.entries(stats.byPattern).forEach(([key, count]) => {
        if (count > 0) report.push(`  ${key}: ${count}`);
    });

    if (stats.unmatchedSamples.size > 0) {
        report.push('\n⚠️ Unmatched Samples (First 50 unique):');
        stats.unmatchedSamples.forEach(s => report.push(`  "${s}"`));
    }

    fs.writeFileSync('analysis_output/date_formats.txt', report.join('\n'));
    console.log('Analysis written to analysis_output/date_formats.txt');
}

analyzeEventDates();
