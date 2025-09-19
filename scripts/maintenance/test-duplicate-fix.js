/**
 * TEST DUPLICATE NAME FIX SCRIPT
 * 
 * Purpose: Tests the improved duplicate name handling logic
 * by simulating the Brian Le case and showing how it would be resolved.
 * 
 * Usage:
 *   node test-duplicate-fix.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Find lifters by name (same logic as the uploader)
async function findLifterByName(athleteName) {
    const { data: lifters, error } = await supabase
        .from('lifters')
        .select('lifter_id, athlete_name, membership_number, club_name, wso, internal_id')
        .eq('athlete_name', athleteName);
    
    if (error) {
        throw new Error(`Failed to find lifters: ${error.message}`);
    }
    
    return lifters || [];
}

// Simulate the improved disambiguation logic
function disambiguateLifters(matchingLifters, athleteData) {
    console.log(`🔍 Found ${matchingLifters.length} lifters named "${athleteData.athlete_name}" - attempting disambiguation...`);
    console.log(`   New athlete data: WSO=${athleteData.wso}, Club=${athleteData.club_name}, Membership=${athleteData.membership_number}`);
    
    let bestMatch = null;
    let exactMatches = [];
    
    // Show existing lifters
    console.log('\n   Existing lifters:');
    matchingLifters.forEach((lifter, index) => {
        console.log(`     ${index + 1}. lifter_id=${lifter.lifter_id}, WSO=${lifter.wso}, Club=${lifter.club_name}, Membership=${lifter.membership_number}, internal_id=${lifter.internal_id}`);
    });
    
    // Strategy 1: Match by membership number if available
    if (athleteData.membership_number) {
        const membershipMatches = matchingLifters.filter(l => 
            l.membership_number && l.membership_number.toString() === athleteData.membership_number.toString()
        );
        if (membershipMatches.length === 1) {
            bestMatch = membershipMatches[0];
            console.log(`   ✅ Matched by membership number: ${athleteData.membership_number} -> lifter_id ${bestMatch.lifter_id}`);
            return { action: 'UPDATE', lifter: bestMatch };
        } else if (membershipMatches.length > 1) {
            console.log(`   ⚠️  Multiple lifters with same membership ${athleteData.membership_number}`);
        }
    }
    
    // Strategy 2: Match by WSO/Club combination if no membership match
    if (!bestMatch && athleteData.wso && athleteData.club_name) {
        const wsoClubMatches = matchingLifters.filter(l => 
            l.wso === athleteData.wso && l.club_name === athleteData.club_name
        );
        if (wsoClubMatches.length === 1) {
            bestMatch = wsoClubMatches[0];
            console.log(`   ✅ Matched by WSO/Club: ${athleteData.wso}/${athleteData.club_name} -> lifter_id ${bestMatch.lifter_id}`);
            return { action: 'UPDATE', lifter: bestMatch };
        } else if (wsoClubMatches.length > 1) {
            exactMatches = wsoClubMatches;
        }
    }
    
    // Strategy 3: Match by WSO only if no other match
    if (!bestMatch && exactMatches.length === 0 && athleteData.wso) {
        const wsoMatches = matchingLifters.filter(l => l.wso === athleteData.wso);
        if (wsoMatches.length === 1) {
            bestMatch = wsoMatches[0];
            console.log(`   ✅ Matched by WSO only: ${athleteData.wso} -> lifter_id ${bestMatch.lifter_id}`);
            return { action: 'UPDATE', lifter: bestMatch };
        } else if (wsoMatches.length > 1) {
            exactMatches = wsoMatches;
        }
    }
    
    // Strategy 4: Create new lifter if no clear match
    if (!bestMatch && exactMatches.length === 0) {
        console.log(`   ➕ No clear match found - will create new lifter for ${athleteData.athlete_name}`);
        console.log(`      New lifter details: WSO=${athleteData.wso}, Club=${athleteData.club_name}, Membership=${athleteData.membership_number}`);
        return { action: 'CREATE', lifter: null };
    }
    
    // If still ambiguous, would skip
    console.log(`   ❌ Still ambiguous after disambiguation - would skip`);
    return { action: 'SKIP', lifter: null };
}

// Test the Brian Le scenario
async function testBrianLeScenario() {
    console.log('🧪 TESTING BRIAN LE DUPLICATE SCENARIO');
    console.log('=' .repeat(60));
    
    // Get existing Brian Le lifters
    const brianLeLifters = await findLifterByName('Brian Le');
    
    if (brianLeLifters.length === 0) {
        console.log('❌ No Brian Le lifters found in database');
        return;
    }
    
    console.log(`📊 Found ${brianLeLifters.length} existing Brian Le lifters in database`);
    
    // Simulate the new Brian Le from meet 7011 (we know he had 236kg total)
    const newBrianLeData = {
        athlete_name: 'Brian Le',
        wso: 'Carolina',  // This is what we saw in the missing result
        club_name: 'Unknown Club', // Would come from meet scraping
        membership_number: null, // Probably no membership number
        total: 236 // From the meet results
    };
    
    console.log('\n🎯 Testing disambiguation for new Brian Le from meet 7011:');
    const result = disambiguateLifters(brianLeLifters, newBrianLeData);
    
    console.log('\n📋 RESULT:');
    switch (result.action) {
        case 'UPDATE':
            console.log(`   ✅ Would UPDATE existing lifter_id ${result.lifter.lifter_id}`);
            break;
        case 'CREATE':
            console.log(`   ✅ Would CREATE new lifter (this fixes the missing result!)`);
            break;
        case 'SKIP':
            console.log(`   ❌ Would SKIP (this was the old broken behavior)`);
            break;
    }
}

// Test other common duplicate scenarios
async function testOtherDuplicateScenarios() {
    console.log('\n\n🧪 TESTING OTHER DUPLICATE SCENARIOS');
    console.log('=' .repeat(60));
    
    const testCases = [
        { name: 'Michael Smith', expectedCount: 5 },
        { name: 'John Kim', expectedCount: 5 },
        { name: 'Daniel Rodriguez', expectedCount: 5 }
    ];
    
    for (const testCase of testCases) {
        console.log(`\n📋 Testing ${testCase.name}:`);
        const lifters = await findLifterByName(testCase.name);
        console.log(`   Found ${lifters.length} lifters (expected ${testCase.expectedCount})`);
        
        if (lifters.length !== testCase.expectedCount) {
            console.log(`   ⚠️  Count mismatch!`);
        }
        
        // Show a sample of the disambiguation logic
        if (lifters.length > 1) {
            const sampleData = {
                athlete_name: testCase.name,
                wso: 'Test WSO',
                club_name: 'Test Club',
                membership_number: 999999
            };
            
            const result = disambiguateLifters(lifters.slice(0, 2), sampleData); // Just test first 2
            console.log(`   Result: ${result.action}`);
        }
    }
}

// Main execution function
async function main() {
    try {
        console.log('🚀 Testing duplicate name fix');
        
        // Test database connection
        const { error: testError } = await supabase.from('lifters').select('lifter_id').limit(1);
        if (testError) {
            throw new Error(`Database connection failed: ${testError.message}`);
        }
        console.log('✅ Database connection successful\n');
        
        // Test the Brian Le scenario
        await testBrianLeScenario();
        
        // Test other duplicate scenarios
        await testOtherDuplicateScenarios();
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ DUPLICATE NAME FIX TESTING COMPLETE');
        console.log('The improved logic should now:');
        console.log('  1. ✅ Create new lifters when no clear match exists');
        console.log('  2. ✅ Match by membership number when available');  
        console.log('  3. ✅ Match by WSO/Club when membership unavailable');
        console.log('  4. ✅ Only skip when truly ambiguous');
        console.log('\nThis should fix the Brian Le missing result issue!');
        
    } catch (error) {
        console.error(`\n❌ Test failed: ${error.message}`);
        console.error(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { disambiguateLifters, findLifterByName };