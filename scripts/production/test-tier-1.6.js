require('dotenv').config({ path: '../../.env' });
const importer = require('./database-importer-custom.js');

async function testTier1_6_Multiple() {
    console.log('\n=============================================');
    console.log('🧪 TIER 1.6 VERIFICATION: MULTIPLE CANDIDATES');
    console.log('=============================================\n');

    const candidates = [
        {
            name: "Elijah  Guzman",
            meetId: 4750, // Placeholder/Real ID
            date: "2025-06-21",
            category: "Men's 13 Under Age Group",
            recordedClass: "48kg",
            bodyweight: "48.01",
            expectedClass: "52kg" // Youth M Current: 48, 52...
        },
        {
            name: "Sarah Mallery",
            meetId: 4425,
            date: "2020-08-31",
            category: "Women's 13 Under Age Group",
            recordedClass: "55kg",
            bodyweight: "49",
            expectedClass: "49kg" // Youth F Hist 2018: 45, 49...
        },
        {
            name: "Zane Chadbourne",
            meetId: 4750,
            date: "2025-06-21",
            category: "Men's 13 Under Age Group",
            recordedClass: "48kg",
            bodyweight: "48.01",
            expectedClass: "52kg"
        }
    ];

    let successCount = 0;

    for (const c of candidates) {
        console.log(`\n---------------------------------------------`);
        console.log(`Testing Candidate: ${c.name}`);
        console.log(`   Date: ${c.date} | Category: ${c.category}`);
        console.log(`   Recorded: ${c.recordedClass} | Bodyweight: ${c.bodyweight}kg`);
        console.log(`   Expected Tier 1.6 Class: ${c.expectedClass}`);

        try {
            // We expect Tier 1 to fail (looking in recordedClass)
            // Then Tier 1.6 to trigger with expectedClass

            const result = await importer.runBase64UrlLookupProtocol(
                c.name,
                [], // No IDs provided
                c.meetId,
                c.date,
                c.category,
                c.recordedClass,
                c.bodyweight
            );

            if (result) {
                console.log(`✅ SUCCESS: Athlete found via Tier 1.6!`);
                successCount++;
            } else {
                console.log(`❌ FAILURE: Athlete not found.`);
            }

        } catch (err) {
            console.error('❌ ERROR:', err);
        }
    }

    console.log('\n=============================================');
    console.log(`🏁 SUMMARY: ${successCount} / ${candidates.length} Successes`);
    console.log('=============================================');
}

// Allow initialization
setTimeout(testTier1_6_Multiple, 2000);
