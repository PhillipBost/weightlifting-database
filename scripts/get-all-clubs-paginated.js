const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function getAllClubsPaginated() {
  console.log('📄 Getting ALL clubs using proper Supabase pagination...');

  try {
    const allClubs = new Set();
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const start = page * pageSize;
      const end = start + pageSize - 1;

      console.log(`📄 Fetching page ${page + 1} (records ${start} to ${end})...`);

      const { data: pageData, error: pageError } = await supabase
        .from('usaw_meet_results')
        .select('club_name')
        .not('club_name', 'is', null)
        .neq('club_name', '')
        .neq('club_name', 'null')
        .neq('club_name', '-')
        .neq('club_name', '.')
        .order('club_name')
        .range(start, end);

      if (pageError) {
        console.error(`❌ Error on page ${page + 1}:`, pageError.message);
        break;
      }

      if (!pageData || pageData.length === 0) {
        console.log(`📄 No more data on page ${page + 1}, pagination complete`);
        hasMore = false;
        break;
      }

      // Add clubs from this page
      let newClubsThisPage = 0;
      pageData.forEach(row => {
        const clubName = row.club_name;
        if (clubName &&
          clubName.trim() !== '' &&
          clubName.trim() !== 'null' &&
          clubName.trim() !== '-' &&
          clubName.trim() !== '.' &&
          clubName.trim().toLowerCase() !== 'null') {

          const trimmedName = clubName.trim();
          if (!allClubs.has(trimmedName)) {
            allClubs.add(trimmedName);
            newClubsThisPage++;
          }
        }
      });

      console.log(`   ✅ Page ${page + 1}: ${pageData.length} records → ${newClubsThisPage} new clubs (${allClubs.size} total unique)`);

      // Show first few clubs from this page as sample
      const pageClubs = Array.from(new Set(pageData.map(r => r.club_name).filter(c => c && c.trim()))).slice(0, 3);
      if (pageClubs.length > 0) {
        console.log(`   📝 Sample: ${pageClubs.join(', ')}`);
      }

      // If we got fewer records than page size, we're done
      if (pageData.length < pageSize) {
        console.log(`📄 Last page received (${pageData.length} < ${pageSize}), pagination complete`);
        hasMore = false;
      }

      page++;

      // Safety limit to prevent infinite loops
      if (page > 500) {
        console.log('⚠️ Safety limit reached (500 pages), stopping');
        break;
      }
    }

    const clubsArray = Array.from(allClubs).sort();

    console.log(`\n✅ PAGINATION COMPLETE: ${clubsArray.length} unique clubs found`);

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

    // Show coverage
    const letters = Object.keys(letterCounts).sort();
    const firstLetter = letters[0];
    const lastLetter = letters[letters.length - 1];
    console.log(`\n🔤 ALPHABET COVERAGE: ${letters.length} letters from ${firstLetter} to ${lastLetter}`);

    // Show first and last clubs
    console.log(`\n📝 FIRST/LAST CLUBS:`);
    console.log(`   First: ${clubsArray[0]}`);
    console.log(`   Last: ${clubsArray[clubsArray.length - 1]}`);

    return clubsArray;

  } catch (error) {
    console.error('❌ Error getting all clubs:', error.message);
    return [];
  }
}

if (require.main === module) {
  getAllClubsPaginated()
    .then((clubs) => {
      console.log(`\n🎯 FINAL PAGINATED COUNT: ${clubs.length} clubs found`);

      if (clubs.length >= 600) {
        console.log('✅ SUCCESS: Found 600+ clubs as expected!');
      } else {
        console.log(`⚠️ Found ${clubs.length} clubs (expected 600+)`);
      }

      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { getAllClubsPaginated };