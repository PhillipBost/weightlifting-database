const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function getAllClubsComprehensive() {
  console.log('🔍 Getting ALL clubs comprehensively (avoiding alphabetical truncation)...');

  try {
    const allClubs = new Set();

    // Strategy: Use smaller time windows to avoid hitting 1000 record limits
    const quarterlyRanges = [
      ['2012-01-01', '2012-12-31'],
      ['2013-01-01', '2013-12-31'],
      ['2014-01-01', '2014-12-31'],
      ['2015-01-01', '2015-12-31'],
      ['2016-01-01', '2016-12-31'],
      ['2017-01-01', '2017-12-31'],
      ['2018-01-01', '2018-12-31'],
      ['2019-01-01', '2019-12-31'],
      ['2020-01-01', '2020-12-31'],
      ['2021-01-01', '2021-12-31'],
      ['2022-01-01', '2022-12-31'],
      ['2023-01-01', '2023-12-31'],
      ['2024-01-01', '2024-12-31'],
      ['2025-01-01', '2025-12-31']
    ];

    for (const [startDate, endDate] of quarterlyRanges) {
      console.log(`📅 Fetching clubs from ${startDate.substring(0, 4)}...`);

      const { data: yearData, error: yearError } = await supabase
        .from('meet_results')
        .select('club_name')
        .gte('date', startDate)
        .lte('date', endDate)
        .not('club_name', 'is', null)
        .neq('club_name', '')
        .neq('club_name', 'null')
        .neq('club_name', '-')
        .neq('club_name', '.')
        .order('club_name');

      if (yearError) {
        console.error(`❌ Error for year ${startDate.substring(0, 4)}:`, yearError.message);
        continue;
      }

      if (yearData && yearData.length > 0) {
        console.log(`   📊 Retrieved ${yearData.length} records for ${startDate.substring(0, 4)}`);

        // Filter and add clean club names
        yearData.forEach(row => {
          const clubName = row.club_name;
          if (clubName &&
              clubName.trim() !== '' &&
              clubName.trim() !== 'null' &&
              clubName.trim() !== '-' &&
              clubName.trim() !== '.' &&
              clubName.trim().toLowerCase() !== 'null') {
            allClubs.add(clubName.trim());
          }
        });

        console.log(`   🏢 ${allClubs.size} total unique clubs so far`);

        // Show alphabet coverage
        const firstLetters = [...allClubs].map(club => club.charAt(0).toUpperCase()).sort();
        const uniqueFirstLetters = [...new Set(firstLetters)];
        console.log(`   🔤 Alphabet coverage: ${uniqueFirstLetters.join(', ')} (${uniqueFirstLetters.length} letters)`);
      }
    }

    const clubsArray = Array.from(allClubs).sort();

    console.log(`\n✅ COMPREHENSIVE RESULT: ${clubsArray.length} unique clubs found`);

    // Show alphabet distribution
    console.log('\n📊 ALPHABET DISTRIBUTION:');
    const letterCounts = {};
    clubsArray.forEach(club => {
      const letter = club.charAt(0).toUpperCase();
      letterCounts[letter] = (letterCounts[letter] || 0) + 1;
    });

    Object.keys(letterCounts).sort().forEach(letter => {
      console.log(`   ${letter}: ${letterCounts[letter]} clubs`);
    });

    // Show samples from different parts of alphabet
    console.log('\n🔤 SAMPLES FROM DIFFERENT LETTERS:');
    const letters = ['A', 'G', 'M', 'S', 'Z'];
    letters.forEach(letter => {
      const letterClubs = clubsArray.filter(club => club.charAt(0).toUpperCase() === letter);
      if (letterClubs.length > 0) {
        console.log(`   ${letter}: ${letterClubs.slice(0, 3).join(', ')} (${letterClubs.length} total)`);
      } else {
        console.log(`   ${letter}: (no clubs found)`);
      }
    });

    return clubsArray;

  } catch (error) {
    console.error('❌ Error getting all clubs:', error.message);
    return [];
  }
}

if (require.main === module) {
  getAllClubsComprehensive()
    .then((clubs) => {
      console.log(`\n🎯 FINAL COUNT: ${clubs.length} clubs found`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { getAllClubsComprehensive };