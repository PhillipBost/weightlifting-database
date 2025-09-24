const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function testBatchFetch() {
  console.log('Testing batch fetch...');

  try {
    // First get total count
    const { count, error: countError } = await supabase
      .from('meet_results')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Count error:', countError.message);
      return;
    }

    console.log(`Total meet_results: ${count}`);

    // Test batch fetching
    let allData = [];
    let start = 0;
    const batchSize = 10000;
    let batchCount = 0;

    while (true) {
      console.log(`Fetching batch ${batchCount + 1} starting at ${start}...`);

      const { data: batch, error: batchError } = await supabase
        .from('meet_results')
        .select('club_name, date, lifter_id, result_id')
        .range(start, start + batchSize - 1);

      if (batchError) {
        console.error('Batch error:', batchError.message);
        break;
      }

      console.log(`Batch ${batchCount + 1} returned ${batch?.length || 0} records`);

      if (!batch || batch.length === 0) {
        console.log('No more data, breaking');
        break;
      }

      allData = allData.concat(batch);
      start += batch.length; // Use actual batch length
      batchCount++;

      if (batch.length < batchSize) {
        console.log('Last batch (partial), breaking');
        break;
      }

      if (batchCount >= 10) { // Safety limit for testing
        console.log('Hit safety limit, breaking');
        break;
      }
    }

    console.log(`Total fetched: ${allData.length} records in ${batchCount} batches`);

    // Count unique clubs
    const clubs = [...new Set(allData
      .filter(result => result.club_name && result.club_name.trim() !== '')
      .map(result => result.club_name))];

    console.log(`Unique clubs in fetched data: ${clubs.length}`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  testBatchFetch()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Script failed:', error.message);
      process.exit(1);
    });
}