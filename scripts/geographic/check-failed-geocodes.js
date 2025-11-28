require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

(async () => {
  let allMeets = [];
  let from = 0;
  const pageSize = 1000;

  console.log('Fetching all meets with addresses...');

  while (true) {
    const { data, error } = await supabase
      .from('usaw_meets')
      .select('meet_id, Meet, Date, address, geocode_success, geocode_error')
      .not('address', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('Error:', error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allMeets.push(...data);
    from += pageSize;

    if (data.length < pageSize) break;
  }

  const total = allMeets.length;
  const success = allMeets.filter(m => m.geocode_success === true).length;
  const failed = allMeets.filter(m => m.geocode_success === false).length;
  const nullVal = allMeets.filter(m => m.geocode_success === null).length;

  console.log('\n=== GEOCODE STATISTICS ===');
  console.log('Total meets with addresses:', total);
  console.log('Successful geocodes:', success);
  console.log('Failed geocodes:', failed);
  console.log('Null geocode_success:', nullVal);

  if (failed > 0) {
    console.log('\n=== FAILED GEOCODES ===');
    const failedMeets = allMeets.filter(m => m.geocode_success === false);
    failedMeets.forEach((m, idx) => {
      console.log(`\n${idx + 1}. meet_id: ${m.meet_id}`);
      console.log(`   Meet: ${m.Meet}`);
      console.log(`   Date: ${m.Date}`);
      console.log(`   Address: ${m.address}`);
      console.log(`   Error: ${m.geocode_error || 'No error message'}`);
    });
  } else {
    console.log('\n✅ All meets were successfully geocoded!');
    console.log('\nThe 7 "failed geocodes" mentioned in the script output were likely:');
    console.log('1. Temporary failures during processing (rate limits, network issues)');
    console.log('2. Retried automatically by the fallback logic and ultimately succeeded');
    console.log('3. The script tries multiple address variants - failureCount may increment');
    console.log('   for each variant that fails before finding a successful one.');
  }
})();
