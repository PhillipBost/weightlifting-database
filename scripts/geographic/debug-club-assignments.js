const { createClient } = require('@supabase/supabase-js');
const { extractStateFromAddress } = require('./club-wso-assigner.js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function debugClubAssignments() {
  console.log('🔍 Debugging club WSO assignments for directional abbreviation errors...\n');

  // Get clubs with directional abbreviations in addresses
  const { data: clubs, error } = await supabase
    .from('usaw_clubs')
    .select('club_name, address, wso_geography')
    .not('address', 'is', null)
    .not('wso_geography', 'is', null);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  const suspiciousClubs = [];

  for (const club of clubs) {
    if (!club.address) continue;

    // Check for directional abbreviations that might cause issues
    const hasDirectional = /\b(NE|NW|SE|SW)\b/i.test(club.address);

    if (hasDirectional) {
      // Test what the current algorithm extracts
      const extractedState = extractStateFromAddress(club.address);

      // Look for potential mismatches
      if (extractedState &&
        ((club.address.includes('NE') && extractedState === 'Nebraska') ||
          (club.address.includes('NW') && extractedState === 'Washington') ||
          (club.address.includes('SE') && extractedState === 'South Carolina') ||
          (club.address.includes('SW') && extractedState === 'Wisconsin'))) {

        suspiciousClubs.push({
          club_name: club.club_name,
          address: club.address,
          current_wso: club.wso_geography,
          extracted_state: extractedState
        });
      }
    }
  }

  console.log(`Found ${suspiciousClubs.length} clubs with potential directional abbreviation errors:\n`);

  suspiciousClubs.slice(0, 10).forEach(club => {
    console.log(`Club: ${club.club_name}`);
    console.log(`  Address: ${club.address}`);
    console.log(`  Current WSO: ${club.current_wso}`);
    console.log(`  Extracted State: ${club.extracted_state}`);
    console.log('---');
  });

  if (suspiciousClubs.length > 10) {
    console.log(`... and ${suspiciousClubs.length - 10} more`);
  }
}

debugClubAssignments().catch(console.error);