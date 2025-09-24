const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function debugPopulateData() {
  console.log('🔍 Debugging populate data fetching...');

  try {
    // Test the exact query from populate script
    console.log('📊 Testing direct query from populate script...');
    const { data: directMetrics, error: directError } = await supabase
      .from('meet_results')
      .select(`
        club_name,
        date,
        lifter_id,
        result_id
      `);

    if (directError) {
      console.error('❌ Direct query error:', directError.message);
      return;
    }

    console.log(`📈 Total meet_results fetched: ${directMetrics.length}`);

    // Check unique clubs in the fetched data
    const clubsFromFetch = [...new Set(directMetrics
      .filter(result => result.club_name && result.club_name.trim() !== '')
      .map(result => result.club_name))];

    console.log(`🏢 Unique clubs in fetched data: ${clubsFromFetch.length}`);

    // Compare with direct club query
    const { data: allClubs, error: clubError } = await supabase
      .from('meet_results')
      .select('club_name')
      .not('club_name', 'is', null)
      .neq('club_name', '');

    if (!clubError) {
      const totalUniqueClubs = [...new Set(allClubs.map(c => c.club_name))];
      console.log(`📊 Total unique clubs (separate query): ${totalUniqueClubs.length}`);

      if (clubsFromFetch.length !== totalUniqueClubs.length) {
        console.log('❌ DISCREPANCY FOUND! The populate script fetch is missing clubs.');

        const missingFromFetch = totalUniqueClubs.filter(club => !clubsFromFetch.includes(club));
        console.log(`Missing from fetch: ${missingFromFetch.length}`);
        console.log('Sample missing:', missingFromFetch.slice(0, 5));
      } else {
        console.log('✅ All clubs present in fetch data');
      }
    }

    // Check if there are any limits being hit
    console.log('\n🔍 Checking for potential limits...');

    // Test a much smaller query to see if it behaves differently
    const { data: smallQuery, error: smallError } = await supabase
      .from('meet_results')
      .select('club_name')
      .limit(1000);

    if (!smallError) {
      const smallClubs = [...new Set(smallQuery
        .filter(result => result.club_name && result.club_name.trim() !== '')
        .map(result => result.club_name))];
      console.log(`Clubs in first 1000 records: ${smallClubs.length}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  debugPopulateData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}