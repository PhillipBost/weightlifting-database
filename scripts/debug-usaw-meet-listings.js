const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function inspectMeetListings() {
    console.log('🔍 Inspecting usaw_meet_listings...\n');
    const { data, error } = await supabase
        .from('usaw_meet_listings')
        .select('event_date, meet_name')
        .limit(20);

    if (error) {
        console.error('❌ Error fetching data:', error);
        return;
    }

    console.log('Sample Data:');
    data.forEach(row => {
        console.log(`Date: "${row.event_date}", Name: "${row.meet_name}"`);
    });
}

inspectMeetListings();
