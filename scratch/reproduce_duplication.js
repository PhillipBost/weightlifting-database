const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' }); // Assuming execution from root

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// MOCKED verification function - always returns false to simulate the issue
async function runSport80MemberUrlVerification(lifterName, potentialLifterIds, targetMeetId) {
    console.log(`  🔍 [MOCK] Verification failed for ${lifterName} (Simulating rendering/timeout failure)`);
    return null; // This triggers the fallback to creation
}

/**
 * Isolated logic from database-importer.js (Lines 469-583)
 */
async function findOrCreateLifter(lifterName, additionalData = {}) {
    const cleanName = lifterName?.toString().trim();
    if (!cleanName) {
        throw new Error('Lifter name is required');
    }

    console.log(`  🔍 Looking for lifter: "${cleanName}"`);

    // Find ALL existing lifters by name (not just one)
    const { data: existingLifters, error: findError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('athlete_name', cleanName);

    if (findError) {
        throw new Error(`Error finding lifter: ${findError.message}`);
    }

    const lifterIds = existingLifters ? existingLifters.map(l => l.lifter_id) : [];

    if (lifterIds.length === 0) {
        // No existing lifter found - create new one
        console.log(`  ➕ Creating new lifter: ${cleanName}`);

        const { data: newLifter, error: createError } = await supabase
            .from('usaw_lifters')
            .insert({
                athlete_name: cleanName,
                membership_number: additionalData.membership_number || null,
                internal_id: additionalData.internal_id || null
            })
            .select()
            .single();

        if (createError) {
            throw new Error(`Error creating lifter: ${createError.message}`);
        }

        console.log(`  ✅ Created new lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
        return newLifter;
    }

    if (lifterIds.length === 1) {
        // Single match found - use it
        const existingLifter = existingLifters[0];
        console.log(`  ✅ Found 1 existing lifter: ${cleanName} (ID: ${lifterIds[0]})`);

        // If we have a target meet, verify participation using Tier 2
        if (additionalData.targetMeetId) {
            // CALLING MOCKED VERIFICATION
            const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId);

            if (verifiedLifterId) {
                const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
                console.log(`  ✅ Verified lifter: ${cleanName} (ID: ${verifiedLifterId})`);
                return verifiedLifter;
            } else {
                // Verification failed - create new lifter as fallback
                console.log(`  ⚠️ Could not verify lifter ${cleanName} - creating new record`);

                const { data: newLifter, error: createError } = await supabase
                    .from('usaw_lifters')
                    .insert({
                        athlete_name: cleanName,
                        membership_number: additionalData.membership_number || null,
                        internal_id: additionalData.internal_id || null
                    })
                    .select()
                    .single();

                if (createError) {
                    throw new Error(`Error creating fallback lifter: ${createError.message}`);
                }

                console.log(`  ➕ Created fallback lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
                return newLifter;
            }
        }

        return existingLifter;
    }

    // Multiple matches found - use Tier 2 verification to disambiguate
    console.log(`  ⚠️ Found ${lifterIds.length} existing lifters with name "${cleanName}" - disambiguating...`);

    if (additionalData.targetMeetId) {
        const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId);

        if (verifiedLifterId) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
            console.log(`  ✅ Verified via Tier 2: ${cleanName} (ID: ${verifiedLifterId})`);
            return verifiedLifter;
        }
    }

    // FALLBACK: If we can't disambiguate, create a new lifter record
    console.log(`  ⚠️ Could not disambiguate lifter "${cleanName}" - ${lifterIds.length} candidates found but none verified - creating new record`);

    const { data: newLifter, error: createError } = await supabase
        .from('usaw_lifters')
        .insert({
            athlete_name: cleanName,
            membership_number: additionalData.membership_number || null,
            internal_id: additionalData.internal_id || null
        })
        .select()
        .single();

    if (createError) {
        throw new Error(`Error creating disambiguation fallback lifter: ${createError.message}`);
    }

    console.log(`  ➕ Created disambiguation fallback lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
    return newLifter;
}

async function runReproduction() {
    const targetName = "REPRODUCTION_TEST_ATHLETE_" + Date.now();
    const mockMeetId = 123456789; // Doesn't matter, we are mocking verification

    console.log(`🚀 Starting reproduction test for athlete: "${targetName}"\n`);

    const createdIds = [];

    for (let i = 1; i <= 10; i++) {
        console.log(`\n--- Iteration ${i} ---`);
        const result = await findOrCreateLifter(targetName, { targetMeetId: mockMeetId });
        createdIds.push(result.lifter_id);
        
        // Count how many records exist now
        const { count } = await supabase
            .from('usaw_lifters')
            .select('*', { count: 'exact', head: true })
            .eq('athlete_name', targetName);
        
        console.log(`📊 Total records in DB now: ${count}`);
    }

    console.log("\n" + "=".repeat(40));
    console.log("🏁 Reproduction Test Results:");
    console.log(`Athlete Name: ${targetName}`);
    console.log(`Iterations: 10`);
    console.log(`Unique lifter_ids created: ${new Set(createdIds).size}`);
    
    if (new Set(createdIds).size === 10) {
        console.log("\n👑 1000% CONFIRMED: 10 duplicate records were created despite finding existing matches.");
    } else {
        console.log("\n❌ Reproduction failed to create 10 distinct records.");
    }
    console.log("=".repeat(40));

    // Cleanup
    console.log(`\n🧹 Cleaning up test records...`);
    const { error: delError } = await supabase
        .from('usaw_lifters')
        .delete()
        .eq('athlete_name', targetName);
    
    if (delError) console.error("❌ Cleanup failed:", delError.message);
    else console.log("✅ Cleanup successful.");
}

runReproduction().catch(err => {
    console.error("💥 Fatal error during reproduction:", err);
    process.exit(1);
});
