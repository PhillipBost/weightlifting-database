const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkCalifornia() {
  const { data: caSouth } = await supabase
    .from('usaw_meets')
    .select('wso_geography')
    .eq('wso_geography', 'California South');

  const { data: caNorth } = await supabase
    .from('usaw_meets')
    .select('wso_geography')
    .eq('wso_geography', 'California North Central');

  console.log(`California North Central: ${caNorth?.length || 0}`);
  console.log(`California South: ${caSouth?.length || 0}`);

  // Check sample
  const { data: sample } = await supabase
    .from('usaw_meets')
    .select('Meet, address, wso_geography')
    .or('wso_geography.eq.California North Central,wso_geography.eq.California South')
    .limit(10);

  console.log('\nSample California assignments:');
  sample?.forEach(meet => {
    const shortAddress = meet.address ? meet.address.substring(0, 60) + '...' : 'No address';
    console.log(`  ${meet.wso_geography}: ${shortAddress}`);
  });
}

checkCalifornia().catch(console.error);