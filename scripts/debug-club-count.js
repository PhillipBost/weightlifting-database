const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function investigateClubDiscrepancy() {
  console.log('🔍 Investigating club count discrepancy...');

  try {
    // Count total unique clubs in meet_results
    const { data: allClubs, error: allError } = await supabase
      .from('meet_results')
      .select('club_name')
      .not('club_name', 'is', null)
      .neq('club_name', '');

    if (allError) throw allError;

    const totalUniqueClubs = [...new Set(allClubs.map(c => c.club_name))];
    console.log(`📊 Total unique clubs in meet_results: ${totalUniqueClubs.length}`);

    // Count clubs in rolling metrics
    const { data: rollingClubs, error: rollingError } = await supabase
      .from('club_rolling_metrics')
      .select('club_name');

    if (rollingError) throw rollingError;

    const rollingUniqueClubs = [...new Set(rollingClubs.map(c => c.club_name))];
    console.log(`📈 Unique clubs in rolling metrics: ${rollingUniqueClubs.length}`);

    // Find missing clubs
    const missingClubs = totalUniqueClubs.filter(club => !rollingUniqueClubs.includes(club));
    console.log(`❌ Missing clubs: ${missingClubs.length}`);

    if (missingClubs.length > 0) {
      console.log('Sample missing clubs:', missingClubs.slice(0, 10));

      // Check if some missing clubs have recent data
      const { data: recentData, error: recentError } = await supabase
        .from('meet_results')
        .select('club_name, date')
        .in('club_name', missingClubs.slice(0, 5))
        .order('date', { ascending: false })
        .limit(10);

      if (!recentError && recentData && recentData.length > 0) {
        console.log('\n📅 Recent competition data for missing clubs:');
        recentData.forEach(row => {
          console.log(` - ${row.club_name} | Last: ${row.date}`);
        });
      }

      // Check if missing clubs have any data at all
      const sampleMissingClub = missingClubs[0];
      const { data: sampleData, error: sampleError } = await supabase
        .from('meet_results')
        .select('club_name, date, lifter_name')
        .eq('club_name', sampleMissingClub)
        .order('date', { ascending: false })
        .limit(5);

      if (!sampleError && sampleData && sampleData.length > 0) {
        console.log(`\n🔍 Sample data for missing club "${sampleMissingClub}":`, sampleData.length, 'records');
        sampleData.forEach(row => {
          console.log(` - ${row.date} | ${row.lifter_name}`);
        });
      }
    }

    // Check the populate script logic
    console.log('\n🛠️ Checking populate script behavior...');
    console.log('Expected records per club:', '28 periods × clubs = total records');
    console.log('Actual calculation: 28 × 252 =', 28 * 252);
    console.log('Current records:', 7056);
    console.log('Missing records:', (28 * totalUniqueClubs.length) - 7056);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  investigateClubDiscrepancy()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}