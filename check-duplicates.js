require('dotenv').config();
const config = require('./scripts/production/iwf-config');

(async () => {
    const { data: all } = await config.supabaseIWF
        .from('iwf_meet_results')
        .select('iwf_result_id, db_lifter_id')
        .eq('iwf_meet_id', 31);
    
    console.log('Total results:', all.length);
    
    const lifterMap = {};
    all.forEach(r => {
        if (!lifterMap[r.db_lifter_id]) {
            lifterMap[r.db_lifter_id] = [];
        }
        lifterMap[r.db_lifter_id].push(r.iwf_result_id);
    });
    
    const duplicates = Object.entries(lifterMap).filter(([id, results]) => results.length > 1);
    
    console.log('Lifters with multiple results:', duplicates.length);
    console.log('Unique lifters:', Object.keys(lifterMap).length);
    
    if (duplicates.length > 0) {
        console.log('Duplicate example:');
        const [lid, rids] = duplicates[0];
        console.log('Lifter ' + lid + ': ' + rids.length + ' results');
    }
})();
