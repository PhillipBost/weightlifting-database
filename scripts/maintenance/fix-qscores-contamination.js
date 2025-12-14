require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function analyzeQScoreContamination() {
    console.log('🔍 Analyzing Q-Score Age Contamination');
    console.log('=====================================');
    console.log(`🕐 Analysis time: ${new Date().toLocaleString()}`);

    try {
        // Test connection
        const { data: testData, error: testError } = await supabase
            .from('usaw_meet_results')
            .select('result_id')
            .limit(1);

        if (testError) {
            throw new Error(`Supabase connection failed: ${testError.message}`);
        }
        console.log('✅ Database connection successful');

        // Query problematic records
        console.log('\n📊 Querying contaminated Q-score data...');

        // Get records with wrong Q-scores for their age
        const { data: wrongQScores, error: wrongError } = await supabase
            .from('usaw_meet_results')
            .select('lifter_name, competition_age, birth_year, date, qpoints, q_youth, q_masters, total, body_weight_kg, gender')
            .or('and(competition_age.lte.9,or(qpoints.not.is.null,q_youth.not.is.null,q_masters.not.is.null)),and(competition_age.gte.10,competition_age.lte.20,or(qpoints.not.is.null,q_masters.not.is.null)),and(competition_age.gte.21,competition_age.lte.30,or(q_youth.not.is.null,q_masters.not.is.null)),and(gender.eq.M,competition_age.gte.31,competition_age.lte.75,or(qpoints.not.is.null,q_youth.not.is.null)),and(gender.eq.F,competition_age.gte.31,competition_age.lte.90,or(qpoints.not.is.null,q_youth.not.is.null)))')
            .limit(20)
            .order('competition_age', { ascending: true });

        if (wrongError) {
            console.error('❌ Error querying wrong Q-scores:', wrongError.message);
        } else {
            console.log(`\n📋 Sample of contaminated records (${wrongQScores?.length || 0} shown):`);
            console.log('Name | Age | Q-points | Q-youth | Q-masters | Expected');
            console.log('-----|-----|----------|---------|-----------|----------');

            wrongQScores?.forEach(record => {
                const age = record.competition_age;
                    let expected = 'None';
                    if (age >= 10 && age <= 20) expected = 'Q-youth only';
                    else if (age >= 21 && age <= 30) expected = 'Q-points only';
                    else if ((record.gender === 'M' && age >= 31 && age <= 75) || (record.gender === 'F' && age >= 31 && age <= 90)) expected = 'Q-masters only';

                console.log(`${(record.lifter_name || 'Unknown').substring(0, 20).padEnd(20)} | ${String(age).padEnd(3)} | ${String(record.qpoints || '').padEnd(8)} | ${String(record.q_youth || '').padEnd(7)} | ${String(record.q_masters || '').padEnd(9)} | ${expected}`);
            });
        }

        // Count contamination by age brackets
        console.log('\n📈 Contamination counts by age bracket:');

        // Ages ≤9 with any Q-scores
        const { count: ages9WithQ, error: error9 } = await supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .lte('competition_age', 9)
            .or('qpoints.not.is.null,q_youth.not.is.null,q_masters.not.is.null');

        if (!error9) {
            console.log(`   Ages ≤9 with Q-scores: ${ages9WithQ || 0} records (should be 0)`);
        }

        // Ages 10-20 with wrong Q-scores
        const { count: ages1020WithWrongQ, error: error1020 } = await supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .gte('competition_age', 10)
            .lte('competition_age', 20)
            .or('qpoints.not.is.null,q_masters.not.is.null');

        if (!error1020) {
            console.log(`   Ages 10-20 with Q-points/Q-masters: ${ages1020WithWrongQ || 0} records (should have Q-youth only)`);
        }

        // Ages 21-30 with wrong Q-scores
        const { count: ages2130WithWrongQ, error: error2130 } = await supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .gte('competition_age', 21)
            .lte('competition_age', 30)
            .or('q_youth.not.is.null,q_masters.not.is.null');

        if (!error2130) {
            console.log(`   Ages 21-30 with Q-youth/Q-masters: ${ages2130WithWrongQ || 0} records (should have Q-points only)`);
        }

        // Ages meeting masters predicate with wrong Q-scores
        const { count: ages31WithWrongQ, error: error31 } = await supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .or('and(gender.eq.M,competition_age.gte.31,competition_age.lte.75,or(qpoints.not.is.null,q_youth.not.is.null)),and(gender.eq.F,competition_age.gte.31,competition_age.lte.90,or(qpoints.not.is.null,q_youth.not.is.null))');

        if (!error31) {
            console.log(`   Ages 31+ with Q-points/Q-youth: ${ages31WithWrongQ || 0} records (should have Q-masters only)`);
        }

        const totalContamination = (ages9WithQ || 0) + (ages1020WithWrongQ || 0) + (ages2130WithWrongQ || 0) + (ages31WithWrongQ || 0);
        console.log(`\n🚨 Total contaminated records: ${totalContamination}`);

        // Get total record count for context
        const { count: totalRecords, error: totalError } = await supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true });

        if (!totalError && totalRecords) {
            const contaminationPercent = ((totalContamination / totalRecords) * 100).toFixed(2);
            console.log(`📊 Database contains ${totalRecords} total records`);
            console.log(`🔢 Contamination rate: ${contaminationPercent}%`);
        }

        console.log('\n✅ Contamination analysis complete');

    } catch (error) {
        console.error('💥 Analysis failed:', error.message);
        process.exit(1);
    }
}

async function cleanQScoreContamination() {
    console.log('\n🧹 Starting Q-Score Contamination Cleanup');
    console.log('==========================================');

    try {
        let totalCleaned = 0;

        // Clean Ages ≤9: Remove all Q-scores
        console.log('🧽 Cleaning ages ≤9 (removing all Q-scores)...');
        const { count: cleaned9, error: error9 } = await supabase
            .from('usaw_meet_results')
            .update({
                qpoints: null,
                q_youth: null,
                q_masters: null
            })
            .lte('competition_age', 9)
            .or('qpoints.not.is.null,q_youth.not.is.null,q_masters.not.is.null');

        if (error9) {
            console.error('❌ Error cleaning ages ≤9:', error9.message);
        } else {
            console.log(`✅ Cleaned ${cleaned9 || 0} records for ages ≤9`);
            totalCleaned += cleaned9 || 0;
        }

        // Clean Ages 10-20: Keep only Q-youth
        console.log('🧽 Cleaning ages 10-20 (keeping Q-youth only)...');
        const { count: cleaned1020, error: error1020 } = await supabase
            .from('usaw_meet_results')
            .update({
                qpoints: null,
                q_masters: null
            })
            .gte('competition_age', 10)
            .lte('competition_age', 20)
            .or('qpoints.not.is.null,q_masters.not.is.null');

        if (error1020) {
            console.error('❌ Error cleaning ages 10-20:', error1020.message);
        } else {
            console.log(`✅ Cleaned ${cleaned1020 || 0} records for ages 10-20`);
            totalCleaned += cleaned1020 || 0;
        }

        // Clean Ages 21-30: Keep only Q-points
        console.log('🧽 Cleaning ages 21-30 (keeping Q-points only)...');
        const { count: cleaned2130, error: error2130 } = await supabase
            .from('usaw_meet_results')
            .update({
                q_youth: null,
                q_masters: null
            })
            .gte('competition_age', 21)
            .lte('competition_age', 30)
            .or('q_youth.not.is.null,q_masters.not.is.null');

        if (error2130) {
            console.error('❌ Error cleaning ages 21-30:', error2130.message);
        } else {
            console.log(`✅ Cleaned ${cleaned2130 || 0} records for ages 21-30`);
            totalCleaned += cleaned2130 || 0;
        }

        // Clean Masters ranges: Men 31-75; Women 31-90 - Keep only Q-masters
        console.log('🧽 Cleaning masters ranges (Men 31-75, Women 31-90) (keeping Q-masters only)...');

        // Men 31-75
        const { count: cleaned31m, error: error31m } = await supabase
            .from('usaw_meet_results')
            .update({ qpoints: null, q_youth: null })
            .gte('competition_age', 31)
            .lte('competition_age', 75)
            .eq('gender', 'M')
            .or('qpoints.not.is.null,q_youth.not.is.null');

        if (error31m) {
            console.error('❌ Error cleaning men 31-75:', error31m.message);
        } else {
            console.log(`✅ Cleaned ${cleaned31m || 0} records for men 31-75`);
            totalCleaned += cleaned31m || 0;
        }

        // Women 31-90
        const { count: cleaned31f, error: error31f } = await supabase
            .from('usaw_meet_results')
            .update({ qpoints: null, q_youth: null })
            .gte('competition_age', 31)
            .lte('competition_age', 90)
            .eq('gender', 'F')
            .or('qpoints.not.is.null,q_youth.not.is.null');

        if (error31f) {
            console.error('❌ Error cleaning women 31-90:', error31f.message);
        } else {
            console.log(`✅ Cleaned ${cleaned31f || 0} records for women 31-90`);
            totalCleaned += cleaned31f || 0;
        }

        console.log(`\n🎉 Cleanup complete! Total records cleaned: ${totalCleaned}`);

    } catch (error) {
        console.error('💥 Cleanup failed:', error.message);
        process.exit(1);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'analyze' || !command) {
        await analyzeQScoreContamination();
    } else if (command === 'clean') {
        await analyzeQScoreContamination();
        console.log('\n⚠️  READY TO CLEAN DATABASE');
        console.log('This will modify existing records. Are you sure? (This script will proceed automatically)');
        await cleanQScoreContamination();
    } else {
        console.log('Usage: node fix-qscores-contamination.js [analyze|clean]');
        console.log('  analyze: Show contamination analysis (default)');
        console.log('  clean: Analyze and then clean contaminated records');
    }
}

if (require.main === module) {
    main();
}

module.exports = { analyzeQScoreContamination, cleanQScoreContamination };