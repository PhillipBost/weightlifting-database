require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkMeet7011() {
    try {
        // Check if meet 7011 exists in meets table
        const { data: meet, error: meetError } = await supabase
            .from('meets')
            .select('meet_id, Meet, Date, meet_internal_id')
            .eq('meet_internal_id', 7011)
            .single();
        
        if (meetError || !meet) {
            console.log('❌ Meet 7011 not found in meets table');
            return;
        }
        
        console.log('✅ Meet 7011 found:');
        console.log(`   Meet: ${meet.Meet}`);
        console.log(`   Date: ${meet.Date}`);
        console.log(`   meet_id: ${meet.meet_id}`);
        
        // Check how many results exist for this meet
        const { count: totalResults } = await supabase
            .from('meet_results')
            .select('result_id', { count: 'exact' })
            .eq('meet_id', meet.meet_id);
        
        console.log(`\n📊 Total results in database for meet 7011: ${totalResults}`);
        
        // Check for any Brian Le results in this meet
        const { data: brianResults, error: brianError } = await supabase
            .from('meet_results')
            .select('result_id, lifter_id, lifter_name, wso, club_name, total')
            .eq('meet_id', meet.meet_id)
            .ilike('lifter_name', '%brian%le%');
        
        if (brianResults && brianResults.length > 0) {
            console.log(`\n✅ Found Brian Le results in meet 7011:`);
            brianResults.forEach((result, i) => {
                console.log(`   ${i+1}. lifter_id=${result.lifter_id}, Name=${result.lifter_name}, WSO=${result.wso}, Total=${result.total}`);
            });
        } else {
            console.log(`\n❌ No Brian Le results found in meet 7011 database records`);
        }
        
        // Also check all Brian Le lifters and their recent results
        console.log(`\n🔍 All Brian Le lifters and their most recent meet:`);
        const { data: allBrians } = await supabase
            .from('lifters')
            .select('lifter_id, athlete_name, wso, internal_id')
            .eq('athlete_name', 'Brian Le');
        
        for (const brian of allBrians || []) {
            const { data: recentResult } = await supabase
                .from('meet_results')
                .select('meet_name, date, wso, total')
                .eq('lifter_id', brian.lifter_id)
                .order('date', { ascending: false })
                .limit(1);
            
            const recent = recentResult?.[0];
            console.log(`   lifter_id=${brian.lifter_id} (${brian.wso}) - Most recent: ${recent?.meet_name || 'None'} (${recent?.date || 'N/A'})`);
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkMeet7011();