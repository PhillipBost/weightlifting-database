const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_IWF_URL, process.env.SUPABASE_IWF_SECRET_KEY);

async function testTrigger() {
  // Find a lifter with multiple results in a year for testing
  console.log('Finding test lifter...');
  const { data: lifters, error } = await supabase
    .from('iwf_meet_results')
    .select('db_lifter_id')
    .gte('date', '2024-01-01')
    .lte('date', '2024-12-31')
    .group('db_lifter_id')
    .having('count', 'gt', 1)
    .limit(1);

  if (error || !lifters || lifters.length === 0) {
    console.log('No test lifter found:', error);
    return;
  }

  const lifterId = lifters[0].db_lifter_id;
  console.log('Using lifter ID:', lifterId);

  // Get a specific record to update
  const { data: records } = await supabase
    .from('iwf_meet_results')
    .select('db_result_id, date, best_snatch_ytd, best_cj_ytd, best_total_ytd')
    .eq('db_lifter_id', lifterId)
    .order('date', { ascending: true })
    .limit(1);

  if (!records || records.length === 0) {
    console.log('No records for lifter');
    return;
  }

  const record = records[0];
  const resultId = record.db_result_id;
  console.log('Test record before update:', record);

  // Update updated_at
  const { error: updateError } = await supabase
    .from('iwf_meet_results')
    .update({ updated_at: new Date().toISOString() })
    .eq('db_result_id', resultId);

  if (updateError) {
    console.log('Update failed:', updateError);
    return;
  }

  console.log('Update successful');

  // Check after update
  const { data: afterRecords } = await supabase
    .from('iwf_meet_results')
    .select('db_result_id, date, best_snatch_ytd, best_cj_ytd, best_total_ytd')
    .eq('db_result_id', resultId);

  console.log('Test record after update:', afterRecords[0]);

  if (afterRecords && afterRecords[0] && JSON.stringify(afterRecords[0]) !== JSON.stringify(record)) {
    console.log('YTD values changed - trigger works!');
  } else {
    console.log('YTD values did not change - trigger may not be firing.');
  }
}

testTrigger();
