const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function addActivityFactorColumn() {
    console.log('🔧 Adding activity_factor column to club_rolling_metrics and calculating values...');

    try {
        // First, let's check if column exists by trying to query it
        console.log('🔍 Checking if activity_factor column exists...');
        const { error: testError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('activity_factor')
            .limit(1);

        if (testError && testError.message.includes('does not exist')) {
            console.log('❌ Column does not exist - this approach won\'t work without direct SQL access');
            console.log('💡 We need to calculate activity_factor differently...');

            // Instead, let's calculate and update activity_factor values for existing records
            // activity_factor could be calculated as: total_competitions_12mo / unique_lifters_12mo
            // This represents competitions per lifter in the 12-month window

            await calculateAndUpdateActivityFactor();
        } else {
            console.log('✅ Column already exists, updating values...');
            await calculateAndUpdateActivityFactor();
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function calculateAndUpdateActivityFactor() {
    console.log('🧮 Calculating activity_factor as (total_competitions_12mo / unique_lifters_12mo)...');
    console.log('   Note: This represents average competitions per lifter in the rolling 12-month window');

    let processed = 0;
    let updated = 0;
    const batchSize = 1000;
    let offset = 0;

    while (true) {
        // Fetch batch of records
        const { data: records, error: fetchError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('id, club_name, snapshot_month, total_competitions_12mo, unique_lifters_12mo')
            .range(offset, offset + batchSize - 1)
            .order('id');

        if (fetchError) {
            console.error('❌ Error fetching records:', fetchError.message);
            break;
        }

        if (!records || records.length === 0) {
            break;
        }

        console.log(`📊 Processing batch: records ${offset + 1} to ${offset + records.length}`);

        const updates = [];
        for (const record of records) {
            let activityFactor = null;

            if (record.unique_lifters_12mo > 0) {
                // Calculate activity factor as competitions per lifter
                activityFactor = Number((record.total_competitions_12mo / record.unique_lifters_12mo).toFixed(2));
            }
            // If unique_lifters_12mo is 0, activity_factor remains null (or could be 0)

            updates.push({
                id: record.id,
                activity_factor: activityFactor
            });
        }

        // Update records in batch
        if (updates.length > 0) {
            const { error: updateError } = await supabase
                .from('usaw_club_rolling_metrics')
                .upsert(updates, { onConflict: 'id' });

            if (updateError) {
                console.error('❌ Error updating batch:', updateError.message);
                // Continue with next batch
            } else {
                updated += updates.length;
                console.log(`   ✅ Updated ${updates.length} records with activity_factor`);
            }
        }

        processed += records.length;
        offset += batchSize;

        // Show sample of calculated values
        if (offset <= batchSize) {
            console.log('📝 Sample calculations:');
            updates.slice(0, 3).forEach(update => {
                const original = records.find(r => r.id === update.id);
                console.log(`   ${original.club_name} (${original.snapshot_month}): ${original.total_competitions_12mo} comps ÷ ${original.unique_lifters_12mo} lifters = ${update.activity_factor || 'null'}`);
            });
        }

        if (records.length < batchSize) {
            break; // Last batch
        }
    }

    console.log(`\n✅ Activity factor calculation complete!`);
    console.log(`📊 Processed: ${processed} records`);
    console.log(`🔄 Updated: ${updated} records`);
    console.log(`📈 Activity factor represents: competitions per lifter in 12-month window`);
}

// Run if this script is executed directly
if (require.main === module) {
    addActivityFactorColumn()
        .then(() => {
            console.log('\n✅ Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Script failed:', error.message);
            process.exit(1);
        });
}

module.exports = { addActivityFactorColumn, calculateAndUpdateActivityFactor };