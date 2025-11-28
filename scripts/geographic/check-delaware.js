const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkDelaware() {
  console.log('🔍 Checking Delaware assignments...');

  const { data: delawareClubs, error } = await supabase
    .from('usaw_clubs')
    .select('club_name, address, wso_geography')
    .eq('wso_geography', 'Delaware');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${delawareClubs.length} clubs assigned to "Delaware"`);
  delawareClubs.forEach(club => {
    console.log(`- ${club.club_name}`);
    console.log(`  Address: ${club.address}`);
    console.log('');
  });

  // Also check what WSO assignments exist
  const { data: allWSOs } = await supabase
    .from('usaw_clubs')
    .select('wso_geography')
    .not('wso_geography', 'is', null);

  const wsoCount = {};
  allWSOs.forEach(club => {
    wsoCount[club.wso_geography] = (wsoCount[club.wso_geography] || 0) + 1;
  });

  console.log('\nAll WSO assignments and counts:');
  Object.entries(wsoCount)
    .sort(([, a], [, b]) => b - a)
    .forEach(([wso, count]) => {
      console.log(`  ${wso}: ${count}`);
    });
}

checkDelaware();