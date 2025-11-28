const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function getAllClubsAlphabetical() {
  console.log('🔤 Getting ALL clubs using alphabetical ranges (A-Z complete coverage)...');

  try {
    const allClubs = new Set();

    // Strategy: Query by alphabetical ranges to avoid truncation
    const alphabetRanges = [
      ['0', '9'],  // Numbers
      ['A', 'C'],  // A-C
      ['D', 'F'],  // D-F
      ['G', 'I'],  // G-I
      ['J', 'L'],  // J-L
      ['M', 'O'],  // M-O
      ['P', 'R'],  // P-R
      ['S', 'U'],  // S-U
      ['V', 'Z']   // V-Z
    ];

    for (const [startLetter, endLetter] of alphabetRanges) {
      console.log(`📅 Fetching clubs ${startLetter}-${endLetter}...`);

      const { data: rangeData, error: rangeError } = await supabase
        .from('usaw_meet_results')
        .select('club_name')
        .gte('club_name', startLetter)
        .lt('club_name', String.fromCharCode(endLetter.charCodeAt(0) + 1)) // Next letter after endLetter
        .not('club_name', 'is', null)
        .neq('club_name', '')
        .neq('club_name', 'null')
        .neq('club_name', '-')
        .neq('club_name', '.')
        .order('club_name');

      if (rangeError) {
        console.error(`❌ Error for range ${startLetter}-${endLetter}:`, rangeError.message);
        continue;
      }

      if (rangeData && rangeData.length > 0) {
        console.log(`   📊 Retrieved ${rangeData.length} records for ${startLetter}-${endLetter}`);

        // Filter and add clean club names
        let addedInRange = 0;
        rangeData.forEach(row => {
          const clubName = row.club_name;
          if (clubName &&
            clubName.trim() !== '' &&
            clubName.trim() !== 'null' &&
            clubName.trim() !== '-' &&
            clubName.trim() !== '.' &&
            clubName.trim().toLowerCase() !== 'null') {

            const trimmedName = clubName.trim();
            const firstChar = trimmedName.charAt(0).toUpperCase();

            // Verify it's actually in our expected range
            if ((startLetter === '0' && /^[0-9]/.test(firstChar)) ||
              (startLetter !== '0' && firstChar >= startLetter && firstChar <= endLetter)) {
              allClubs.add(trimmedName);
              addedInRange++;
            }
          }
        });

        console.log(`   ✅ Added ${addedInRange} unique clubs, ${allClubs.size} total so far`);

        // Show sample clubs from this range
        const rangeClubs = Array.from(allClubs).filter(club => {
          const firstChar = club.charAt(0).toUpperCase();
          if (startLetter === '0') return /^[0-9]/.test(firstChar);
          return firstChar >= startLetter && firstChar <= endLetter;
        }).sort().slice(0, 3);

        if (rangeClubs.length > 0) {
          console.log(`   🏢 Sample: ${rangeClubs.join(', ')}`);
        }
      } else {
        console.log(`   📊 No records found for ${startLetter}-${endLetter}`);
      }
    }

    const clubsArray = Array.from(allClubs).sort();

    console.log(`\n✅ COMPLETE ALPHABETICAL RESULT: ${clubsArray.length} unique clubs found`);

    // Show comprehensive alphabet distribution
    console.log('\n📊 COMPLETE ALPHABET DISTRIBUTION:');
    const letterCounts = {};
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(char => letterCounts[char] = 0);

    clubsArray.forEach(club => {
      const letter = club.charAt(0).toUpperCase();
      if (letterCounts.hasOwnProperty(letter)) {
        letterCounts[letter]++;
      }
    });

    Object.keys(letterCounts).forEach(letter => {
      if (letterCounts[letter] > 0) {
        console.log(`   ${letter}: ${letterCounts[letter]} clubs`);
      }
    });

    // Show samples from across the alphabet
    console.log('\n🔤 SAMPLES FROM ACROSS ALPHABET:');
    const testLetters = ['A', 'H', 'M', 'P', 'S', 'T', 'W', 'Z'];
    testLetters.forEach(letter => {
      const letterClubs = clubsArray.filter(club => club.charAt(0).toUpperCase() === letter);
      if (letterClubs.length > 0) {
        console.log(`   ${letter}: ${letterClubs.slice(0, 2).join(', ')} (${letterClubs.length} total)`);
      } else {
        console.log(`   ${letter}: (no clubs)`);
      }
    });

    return clubsArray;

  } catch (error) {
    console.error('❌ Error getting all clubs:', error.message);
    return [];
  }
}

if (require.main === module) {
  getAllClubsAlphabetical()
    .then((clubs) => {
      console.log(`\n🎯 FINAL COMPLETE COUNT: ${clubs.length} clubs found across full alphabet`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { getAllClubsAlphabetical };