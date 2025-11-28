const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function getAllClubsRobust() {
  console.log('🔍 Finding ALL unique clubs in the system...');

  try {
    // Method 1: Try SQL RPC first
    console.log('📊 Attempting SQL RPC method...');
    const { data: sqlData, error: sqlError } = await supabase.rpc('exec_sql', {
      sql: 'SELECT DISTINCT club_name FROM meet_results WHERE club_name IS NOT NULL AND club_name != \'\' ORDER BY club_name LIMIT 1000'
    });

    if (!sqlError && sqlData && sqlData.length > 0) {
      console.log(`✅ SQL RPC succeeded: Found ${sqlData.length} clubs`);
      const clubs = sqlData.map(row => row.club_name);
      console.log('Sample clubs:', clubs.slice(0, 10));
      return clubs;
    }

    // Method 2: Aggregate from temporal queries
    console.log('📊 SQL RPC failed, using temporal aggregation method...');

    const allClubs = new Set();

    // Query different time periods to build up complete club list
    const yearRanges = [
      ['2012-01-01', '2014-12-31'],
      ['2015-01-01', '2017-12-31'],
      ['2018-01-01', '2020-12-31'],
      ['2021-01-01', '2023-12-31'],
      ['2024-01-01', '2025-12-31']
    ];

    for (const [startDate, endDate] of yearRanges) {
      console.log(`📅 Fetching clubs active between ${startDate} and ${endDate}...`);

      const { data: periodData, error: periodError } = await supabase
        .from('usaw_meet_results')
        .select('club_name')
        .gte('date', startDate)
        .lte('date', endDate)
        .not('club_name', 'is', null)
        .neq('club_name', '')
        .neq('club_name', 'null')  // Exclude string "null"
        .neq('club_name', '-')     // Exclude "-" entries
        .order('club_name');

      if (periodError) {
        console.error(`❌ Error for period ${startDate}-${endDate}:`, periodError.message);
        continue;
      }

      if (periodData && periodData.length > 0) {
        // Additional filtering to ensure clean club names
        periodData.forEach(row => {
          const clubName = row.club_name;
          if (clubName &&
            clubName.trim() !== '' &&
            clubName.trim() !== 'null' &&
            clubName.trim() !== '-' &&
            clubName.trim().toLowerCase() !== 'null') {
            allClubs.add(clubName.trim());
          }
        });
        console.log(`   Found ${periodData.length} records, ${allClubs.size} total unique clubs so far`);
      }
    }

    const clubsArray = Array.from(allClubs).sort();
    console.log(`✅ Temporal method completed: ${clubsArray.length} unique clubs found`);
    console.log('Sample clubs:', clubsArray.slice(0, 10));

    return clubsArray;

  } catch (error) {
    console.error('❌ Error getting all clubs:', error.message);
    return [];
  }
}

if (require.main === module) {
  getAllClubsRobust()
    .then((clubs) => {
      console.log(`\n📊 FINAL RESULT: ${clubs.length} unique clubs found`);
      if (clubs.length > 0) {
        console.log('First 20 clubs:');
        clubs.slice(0, 20).forEach((club, i) => {
          console.log(`  ${i + 1}. ${club}`);
        });
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { getAllClubsRobust };