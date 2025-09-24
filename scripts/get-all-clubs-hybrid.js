const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function getAllClubsHybrid() {
  console.log('🔤 Getting ALL clubs using hybrid approach (temporal + alphabetical)...');
  console.log('   This ensures we get clubs from the full alphabet A-Z');

  try {
    const allClubs = new Set();

    // Combine temporal ranges with alphabetical filtering
    const yearRanges = [
      ['2012-01-01', '2015-12-31'],
      ['2016-01-01', '2019-12-31'],
      ['2020-01-01', '2023-12-31'],
      ['2024-01-01', '2025-12-31']
    ];

    const alphabetRanges = [
      ['0', 'D'],  // Numbers and A-D
      ['E', 'L'],  // E-L
      ['M', 'S'],  // M-S
      ['T', 'Z']   // T-Z
    ];

    for (const [startYear, endYear] of yearRanges) {
      for (const [startLetter, endLetter] of alphabetRanges) {
        console.log(`📅 Fetching ${startYear.substring(0, 4)}-${endYear.substring(0, 4)} clubs ${startLetter}-${endLetter}...`);

        const { data: segmentData, error: segmentError } = await supabase
          .from('meet_results')
          .select('club_name')
          .gte('date', startYear)
          .lte('date', endYear)
          .gte('club_name', startLetter)
          .lt('club_name', String.fromCharCode(endLetter.charCodeAt(0) + 1))
          .not('club_name', 'is', null)
          .neq('club_name', '')
          .neq('club_name', 'null')
          .neq('club_name', '-')
          .neq('club_name', '.')
          .order('club_name');

        if (segmentError) {
          console.error(`❌ Error for ${startYear.substring(0, 4)}-${endYear.substring(0, 4)} ${startLetter}-${endLetter}:`, segmentError.message);
          continue;
        }

        if (segmentData && segmentData.length > 0) {
          let addedInSegment = 0;
          const segmentClubs = new Set();

          segmentData.forEach(row => {
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
                segmentClubs.add(trimmedName);
                addedInSegment++;
              }
            }
          });

          console.log(`   📊 ${segmentData.length} records → ${addedInSegment} new clubs (${allClubs.size} total)`);

          // Show sample from this segment
          const samples = Array.from(segmentClubs).slice(0, 2);
          if (samples.length > 0) {
            console.log(`   🏢 Sample: ${samples.join(', ')}`);
          }
        } else {
          console.log(`   📊 No records for this segment`);
        }
      }
    }

    const clubsArray = Array.from(allClubs).sort();

    console.log(`\n✅ HYBRID RESULT: ${clubsArray.length} unique clubs found`);

    // Show comprehensive alphabet distribution
    console.log('\n📊 ALPHABET DISTRIBUTION:');
    const letterCounts = {};
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(char => letterCounts[char] = 0);

    clubsArray.forEach(club => {
      const letter = club.charAt(0).toUpperCase();
      if (letterCounts.hasOwnProperty(letter)) {
        letterCounts[letter]++;
      }
    });

    // Only show letters that have clubs
    Object.keys(letterCounts).forEach(letter => {
      if (letterCounts[letter] > 0) {
        console.log(`   ${letter}: ${letterCounts[letter]} clubs`);
      }
    });

    // Verify we have clubs across the alphabet
    const lettersWithClubs = Object.keys(letterCounts).filter(letter => letterCounts[letter] > 0);
    const lastLetter = lettersWithClubs[lettersWithClubs.length - 1];
    console.log(`\n🔤 ALPHABET COVERAGE: ${lettersWithClubs.length} letters (through ${lastLetter})`);

    // Show samples from different parts of alphabet
    console.log('\n🔍 SAMPLES FROM KEY LETTERS:');
    const keyLetters = ['A', 'H', 'N', 'S', 'W', 'Z'];
    keyLetters.forEach(letter => {
      const letterClubs = clubsArray.filter(club => club.charAt(0).toUpperCase() === letter);
      if (letterClubs.length > 0) {
        console.log(`   ${letter}: ${letterClubs.slice(0, 2).join(', ')} (${letterClubs.length} total)`);
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
  getAllClubsHybrid()
    .then((clubs) => {
      console.log(`\n🎯 FINAL HYBRID COUNT: ${clubs.length} clubs found`);
      const lastClub = clubs[clubs.length - 1];
      const firstLetter = lastClub ? lastClub.charAt(0).toUpperCase() : 'N/A';
      console.log(`📝 Last club alphabetically: "${lastClub}" (starts with ${firstLetter})`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { getAllClubsHybrid };