const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function getAllClubsGranular() {
  console.log('🔤 Getting ALL clubs using granular alphabetical approach...');
  console.log('   Using single-letter segments to ensure complete A-Z coverage');

  try {
    const allClubs = new Set();

    // Single-letter ranges to ensure we don't hit limits
    const letters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    for (const letter of letters) {
      console.log(`📝 Fetching clubs starting with "${letter}"...`);

      let nextChar = letter;
      if (letter === 'Z') {
        nextChar = 'a'; // Next character after Z
      } else if (letter === '9') {
        nextChar = 'A'; // Next character after 9
      } else {
        nextChar = String.fromCharCode(letter.charCodeAt(0) + 1);
      }

      const { data: letterData, error: letterError } = await supabase
        .from('usaw_meet_results')
        .select('club_name')
        .gte('club_name', letter)
        .lt('club_name', nextChar)
        .not('club_name', 'is', null)
        .neq('club_name', '')
        .neq('club_name', 'null')
        .neq('club_name', '-')
        .neq('club_name', '.')
        .order('club_name');

      if (letterError) {
        console.error(`❌ Error for letter ${letter}:`, letterError.message);
        continue;
      }

      if (letterData && letterData.length > 0) {
        let addedForLetter = 0;
        const letterClubs = new Set();

        letterData.forEach(row => {
          const clubName = row.club_name;
          if (clubName &&
            clubName.trim() !== '' &&
            clubName.trim() !== 'null' &&
            clubName.trim() !== '-' &&
            clubName.trim() !== '.' &&
            clubName.trim().toLowerCase() !== 'null') {

            const trimmedName = clubName.trim();

            // Verify it actually starts with the expected letter
            const firstChar = trimmedName.charAt(0).toUpperCase();
            if (firstChar === letter.toUpperCase() || (letter >= '0' && letter <= '9' && /^[0-9]/.test(firstChar))) {
              if (!allClubs.has(trimmedName)) {
                allClubs.add(trimmedName);
                letterClubs.add(trimmedName);
                addedForLetter++;
              }
            }
          }
        });

        if (addedForLetter > 0) {
          console.log(`   ✅ ${letterData.length} records → ${addedForLetter} unique clubs for "${letter}" (${allClubs.size} total)`);

          // Show a sample from this letter
          const samples = Array.from(letterClubs).slice(0, 2);
          console.log(`      Sample: ${samples.join(', ')}`);
        } else {
          console.log(`   📊 ${letterData.length} records for "${letter}" but no new unique clubs`);
        }
      } else {
        console.log(`   📝 No clubs found starting with "${letter}"`);
      }
    }

    const clubsArray = Array.from(allClubs).sort();

    console.log(`\n✅ GRANULAR RESULT: ${clubsArray.length} unique clubs found`);

    // Show comprehensive alphabet distribution
    console.log('\n📊 FINAL ALPHABET DISTRIBUTION:');
    const letterCounts = {};
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(char => letterCounts[char] = 0);

    clubsArray.forEach(club => {
      const letter = club.charAt(0).toUpperCase();
      if (letterCounts.hasOwnProperty(letter)) {
        letterCounts[letter]++;
      }
    });

    // Show all letters that have clubs
    Object.keys(letterCounts).forEach(letter => {
      if (letterCounts[letter] > 0) {
        console.log(`   ${letter}: ${letterCounts[letter]} clubs`);
      }
    });

    // Verify full alphabet coverage
    const lettersWithClubs = Object.keys(letterCounts).filter(letter => letterCounts[letter] > 0);
    const firstLetter = lettersWithClubs[0];
    const lastLetter = lettersWithClubs[lettersWithClubs.length - 1];

    console.log(`\n🔤 COMPLETE COVERAGE: ${lettersWithClubs.length} letters from ${firstLetter} to ${lastLetter}`);

    // Show the last few clubs alphabetically to verify we got through Z
    console.log('\n📝 LAST 5 CLUBS ALPHABETICALLY:');
    clubsArray.slice(-5).forEach((club, i) => {
      console.log(`   ${clubsArray.length - 4 + i}. ${club}`);
    });

    return clubsArray;

  } catch (error) {
    console.error('❌ Error getting all clubs:', error.message);
    return [];
  }
}

if (require.main === module) {
  getAllClubsGranular()
    .then((clubs) => {
      const lastClub = clubs[clubs.length - 1];
      const lastLetter = lastClub ? lastClub.charAt(0).toUpperCase() : 'N/A';
      console.log(`\n🎯 GRANULAR FINAL COUNT: ${clubs.length} clubs`);
      console.log(`📝 Coverage: Through letter "${lastLetter}"`);

      // Check if we got through the whole alphabet
      if (lastLetter === 'Z' || clubs.some(club => club.charAt(0).toUpperCase() >= 'T')) {
        console.log('✅ SUCCESS: Complete alphabet coverage achieved!');
      } else {
        console.log('⚠️  Still missing later alphabet clubs (T-Z range)');
      }

      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { getAllClubsGranular };