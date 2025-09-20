const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkAssignmentStats() {
  console.log('📊 WSO Assignment Statistics...\n');

  // Count total assigned
  const { data: assigned, error: assignedError } = await supabase
    .from('meets')
    .select('wso_geography')
    .not('wso_geography', 'is', null);

  if (assignedError) {
    console.error('Error:', assignedError.message);
    return;
  }

  console.log(`Total assigned: ${assigned.length}`);

  // Count by WSO
  const counts = {};
  assigned.forEach(meet => {
    counts[meet.wso_geography] = (counts[meet.wso_geography] || 0) + 1;
  });

  console.log('\nAssignments by WSO:');
  Object.entries(counts)
    .sort(([,a], [,b]) => b - a)
    .forEach(([wso, count]) => {
      console.log(`  ${wso}: ${count}`);
    });
}

checkAssignmentStats().catch(console.error);