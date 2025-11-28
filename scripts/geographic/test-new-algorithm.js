const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Load the updated functions
const { assignMeetWSO } = require('./meet-wso-assigner.js');

async function testNewAlgorithm() {
  console.log('🧪 Testing new coordinate-only assignment algorithm...');

  // Get a small sample of meets with coordinates
  const { data: meets, error } = await supabase
    .from('usaw_meets')
    .select('*')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(10);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log(`Testing ${meets.length} meets...\n`);

  for (const meet of meets) {
    const assignment = assignMeetWSO(meet, {});
    console.log(`Meet: ${meet.Meet}`);
    console.log(`  Location: ${meet.address || 'N/A'}`);
    console.log(`  Coordinates: ${meet.latitude}, ${meet.longitude}`);
    console.log(`  Assigned WSO: ${assignment.assigned_wso || 'None'}`);
    console.log(`  Method: ${assignment.assignment_method || 'None'}`);
    console.log(`  Confidence: ${assignment.confidence}`);
    console.log(`  Reasoning: ${assignment.details.reasoning.join('; ')}`);
    console.log('---');
  }
}

testNewAlgorithm().catch(console.error);