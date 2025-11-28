/**
 * Validate Contamination Fixes Script
 * 
 * Quick validation to check that specific contamination cases were resolved
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function validateSpecificFixes() {
    console.log('🔍 Validating specific contamination fixes...');
    console.log('='.repeat(50));

    try {
        // Check Handle Barbell meets (Tennessee → Carolina issue)
        console.log('\n1. Tennessee/Carolina contamination fixes:');
        const { data: handleMeets, error1 } = await supabase
            .from('usaw_meets')
            .select('Meet, wso_geography, address, city, state')
            .ilike('Meet', '%Handle Barbell%');

        if (handleMeets && handleMeets.length > 0) {
            handleMeets.forEach(meet => {
                console.log(`   ✓ "${meet.Meet}": ${meet.wso_geography}`);
                console.log(`     Location: ${meet.city}, ${meet.state}`);
            });
        } else {
            console.log('   No Handle Barbell meets found');
        }

        // Check Bakersfield meets (California regional contamination)
        console.log('\n2. California regional contamination fixes:');
        const { data: bakersfieldMeets, error2 } = await supabase
            .from('usaw_meets')
            .select('Meet, wso_geography, address, city, state')
            .ilike('Meet', '%Bakersfield%');

        if (bakersfieldMeets && bakersfieldMeets.length > 0) {
            bakersfieldMeets.forEach(meet => {
                console.log(`   ✓ "${meet.Meet}": ${meet.wso_geography}`);
                console.log(`     Location: ${meet.city}, ${meet.state}`);
            });
        } else {
            console.log('   No Bakersfield meets found');
        }

        // Check Ann Arbor meets (Michigan → Ohio contamination)
        console.log('\n3. Michigan/Ohio contamination fixes:');
        const { data: annArborMeets, error3 } = await supabase
            .from('usaw_meets')
            .select('Meet, wso_geography, address, city, state')
            .ilike('Meet', '%Ann Arbor%');

        if (annArborMeets && annArborMeets.length > 0) {
            annArborMeets.forEach(meet => {
                console.log(`   ✓ "${meet.Meet}": ${meet.wso_geography}`);
                console.log(`     Location: ${meet.city}, ${meet.state}`);
            });
        } else {
            console.log('   No Ann Arbor meets found');
        }

        // General contamination check by WSO
        console.log('\n4. Overall contamination status:');
        const { data: allMeets, error4 } = await supabase
            .from('usaw_meets')
            .select('wso_geography')
            .not('wso_geography', 'is', null)
            .not('latitude', 'is', null)
            .not('longitude', 'is', null);

        console.log(`   Total meets with coordinates and WSO: ${allMeets?.length || 0}`);

        // Count by WSO to check for reasonable distribution
        if (allMeets) {
            const wsoCounts = {};
            allMeets.forEach(meet => {
                wsoCounts[meet.wso_geography] = (wsoCounts[meet.wso_geography] || 0) + 1;
            });

            console.log('\n5. Current WSO distribution:');
            Object.entries(wsoCounts)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .forEach(([wso, count]) => {
                    console.log(`   ${wso}: ${count} meets`);
                });
        }

        console.log('\n✅ Validation complete!');

    } catch (error) {
        console.error('❌ Validation failed:', error.message);
    }
}

if (require.main === module) {
    validateSpecificFixes();
}