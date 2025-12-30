require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Helper from database-importer-custom.js
function calculateStandardWeightClass(ageCategory, bodyWeight, eventDateStr) {
    if (!bodyWeight || isNaN(bodyWeight)) return null;
    const itemDate = new Date(eventDateStr);
    const bw = parseFloat(bodyWeight);

    // Normalize Age Category/Gender
    const category = (ageCategory || '').toLowerCase();
    const isFemale = category.includes('women') || (category.includes('female') && !category.includes('male'));

    // Determine Era
    const DATE_JUNE_2025 = new Date('2025-06-01');
    const DATE_NOV_2018 = new Date('2018-11-01');
    const DATE_JAN_1998 = new Date('1998-01-01');

    let era = 'legacy'; // Default to oldest if very old
    if (itemDate >= DATE_JUNE_2025) era = 'current';
    else if (itemDate >= DATE_NOV_2018) era = 'historical_2018';
    else if (itemDate >= DATE_JAN_1998) era = 'historical_1998';

    // Define Weight Classes Mapping
    const weightClasses = {
        current: {
            M: [60, 65, 71, 79, 88, 94, 110], // >110 is max
            F: [48, 53, 58, 63, 69, 77, 86]   // >86 is max
        },
        historical_2018: {
            M: [55, 61, 67, 73, 81, 89, 96, 102, 109], // >109 is max
            F: [45, 49, 55, 59, 64, 71, 76, 81, 87]    // >87 is max
        },
        historical_1998: {
            M: [56, 62, 69, 77, 85, 94, 105], // >105 is max
            F: [48, 53, 58, 63, 69, 75, 90]   // >90 is max 
        }
    };

    // Select limits based on Era and Gender
    const limits = weightClasses[era][isFemale ? 'F' : 'M'];

    // Find class
    for (const limit of limits) {
        if (bw <= limit) return `${limit}kg`;
    }

    // If heavier than all limits, return highest+kg
    const maxLimit = limits[limits.length - 1];
    return `${maxLimit}+kg`;
}

const candidates = [
    317320, 304743, 297030, 305973, 300962, 297051, 307125, 313102, 317154, 304568,
    424240, 305015, 383916, 304552, 423848, 423728, 439786, 439787, 439788, 297053,
    297035, 297049, 32063, 382787, 304439, 300781, 189481, 301776, 304711, 305957,
    301871, 297057, 360825, 319581, 338994, 340294, 381671, 356639, 423728
];

async function findCandidates() {
    console.log(`🔍 Checking ${candidates.length} candidates from log file...`);

    const { data: results, error } = await supabase
        .from('usaw_meet_results')
        .select('*')
        .in('result_id', candidates);

    if (error) {
        console.error('❌ Error:', error);
        return;
    }

    let mismatchCount = 0;

    for (const row of results) {
        // Skip if missing data
        if (!row.body_weight_kg || !row.weight_class || !row.date) continue;

        // Skip "Unknown" or trivial matches
        if (row.weight_class === 'Unknown' || row.weight_class === 'N/A') continue;

        const calculated = calculateStandardWeightClass(row.age_category, row.body_weight_kg, row.date);

        if (calculated && calculated !== row.weight_class) {
            const cleanRecorded = row.weight_class.replace(/\s/g, '');
            const cleanCalc = calculated.replace(/\s/g, '');

            if (cleanRecorded !== cleanCalc) {
                const numRecorded = parseFloat(cleanRecorded);
                const numCalc = parseFloat(cleanCalc);

                if (numRecorded !== numCalc) {
                    console.log(`\n🚩 CANDIDATE MATCH: ${row.lifter_name} (Result ID: ${row.result_id})`);
                    console.log(`   Date: ${row.date}`);
                    console.log(`   Recorded: ${row.weight_class}`);
                    console.log(`   Bodyweight: ${row.body_weight_kg}kg`);
                    console.log(`   Calculated: ${calculated}`);
                    mismatchCount++;
                }
            }
        }
    }

    console.log(`\n✅ Check complete. Found ${mismatchCount} mismatches.`);
}

findCandidates();
