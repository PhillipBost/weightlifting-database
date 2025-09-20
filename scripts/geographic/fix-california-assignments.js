const { createClient } = require('@supabase/supabase-js');
const { assignMeetWSO } = require('./meet-wso-assigner.js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function fixCaliforniaAssignments() {
  console.log('🔧 Fixing California WSO assignments...');

  // Get all California meets
  const { data: californiaMeets, error } = await supabase
    .from('meets')
    .select('*')
    .eq('wso_geography', 'California North Central');

  if (error) {
    console.error('Error fetching California meets:', error.message);
    return;
  }

  console.log(`Found ${californiaMeets.length} California meets to re-process`);

  let updated = 0;
  let southCount = 0;
  let northCount = 0;

  for (const meet of californiaMeets) {
    const assignment = assignMeetWSO(meet, {});

    if (assignment.assigned_wso && assignment.assigned_wso !== meet.wso_geography) {
      // Update the assignment
      const { error: updateError } = await supabase
        .from('meets')
        .update({ wso_geography: assignment.assigned_wso })
        .eq('meet_id', meet.meet_id);

      if (!updateError) {
        updated++;
        if (assignment.assigned_wso === 'California South') {
          southCount++;
          console.log(`  → South: ${meet.Meet} (${meet.address?.substring(0, 50)}...)`);
        } else {
          northCount++;
        }
      } else {
        console.error(`Failed to update meet ${meet.meet_id}:`, updateError.message);
      }
    }
  }

  console.log(`\\n✅ California assignment fix complete:`);
  console.log(`  Updated: ${updated} meets`);
  console.log(`  California South: ${southCount}`);
  console.log(`  California North Central: ${northCount}`);
}

fixCaliforniaAssignments().catch(console.error);