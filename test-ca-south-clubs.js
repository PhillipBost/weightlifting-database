const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function queryCaliforniaSouthClubs() {
    const { data, error } = await supabase
        .from('clubs')
        .select('club_name, address, wso_geography, latitude, longitude')
        .eq('wso_geography', 'California South')
        .ilike('club_name', '%barbell%')
        .order('club_name');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`\nFound ${data.length} barbell clubs assigned to California South:\n`);

    if (data.length === 0) {
        console.log('✅ No barbell clubs found in California South WSO (this is expected after fixes)');
    } else {
        data.forEach(club => {
            console.log(`Club: ${club.club_name}`);
            console.log(`Address: ${club.address || 'N/A'}`);
            console.log(`Coordinates: ${club.latitude || 'N/A'}, ${club.longitude || 'N/A'}`);
            console.log(`WSO: ${club.wso_geography}`);
            console.log('---');
        });
    }
}

queryCaliforniaSouthClubs();
