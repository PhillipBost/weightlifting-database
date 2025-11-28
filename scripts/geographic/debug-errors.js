const { createClient } = require('@supabase/supabase-js');
const { assignMeetWSO } = require('./meet-wso-assigner.js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function debugSpecificErrors() {
  console.log('🔍 Debugging specific error cases...\n');

  // Query the specific problematic meets
  const errorMeetIds = [6943, 6902, 6840, 6798];

  for (const meetId of errorMeetIds) {
    const { data: meet, error } = await supabase
      .from('usaw_meets')
      .select('*')
      .eq('meet_id', meetId)
      .single();

    if (error) {
      console.error(`Error fetching meet ${meetId}:`, error.message);
      continue;
    }

    console.log(`=== MEET ${meetId} ===`);
    console.log(`Meet Name: ${meet.Meet}`);
    console.log(`Address: ${meet.address || 'N/A'}`);
    console.log(`City: ${meet.city || 'N/A'}`);
    console.log(`State: ${meet.state || 'N/A'}`);
    console.log(`Current WSO: ${meet.wso_geography || 'None'}`);
    console.log(`Coordinates: ${meet.latitude}, ${meet.longitude}`);

    // Test the assignment
    const assignment = assignMeetWSO(meet, {});
    console.log(`\nAssignment Result:`);
    console.log(`  Assigned WSO: ${assignment.assigned_wso || 'None'}`);
    console.log(`  Method: ${assignment.assignment_method || 'None'}`);
    console.log(`  Confidence: ${assignment.confidence}`);
    console.log(`  Extracted State: ${assignment.details.extracted_state || 'None'}`);
    console.log(`  Reasoning: ${assignment.details.reasoning.join('; ')}`);
    console.log('---\n');
  }
}

debugSpecificErrors().catch(console.error);