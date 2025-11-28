const { createClient } = require('@supabase/supabase-js');
const { extractStateFromAddress } = require('./club-wso-assigner.js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function investigateAlabama() {
  console.log('🔍 Investigating Alabama WSO assignments...\n');

  try {
    const { data: clubs, error } = await supabase
      .from('usaw_clubs')
      .select('club_name, address, wso_geography')
      .eq('wso_geography', 'Alabama')
      .order('club_name');

    if (error) throw error;

    console.log(`Found ${clubs.length} clubs assigned to Alabama WSO:\n`);

    clubs.forEach((club, i) => {
      const extractedState = extractStateFromAddress(club.address || '');
      const shortAddr = club.address ? club.address.substring(0, 70) + (club.address.length > 70 ? '...' : '') : 'No address';

      console.log(`${i + 1}. ${club.club_name}`);
      console.log(`   Address: ${shortAddr}`);
      console.log(`   Extracted State: ${extractedState || 'None'}`);

      // Flag suspicious assignments
      if (extractedState && extractedState !== 'Alabama') {
        console.log(`   ⚠️  SUSPICIOUS: Extracted "${extractedState}" but assigned to Alabama`);
      }
      console.log('');
    });

    // Summary
    const stateMatches = clubs.filter(club => extractStateFromAddress(club.address || '') === 'Alabama').length;
    const otherStates = clubs.filter(club => {
      const state = extractStateFromAddress(club.address || '');
      return state && state !== 'Alabama';
    }).length;

    console.log('📊 Summary:');
    console.log(`  Total Alabama assignments: ${clubs.length}`);
    console.log(`  Correctly match Alabama: ${stateMatches}`);
    console.log(`  Extract other states: ${otherStates}`);
    console.log(`  No state extracted: ${clubs.length - stateMatches - otherStates}`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

investigateAlabama();