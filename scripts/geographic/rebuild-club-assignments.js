const { createClient } = require('@supabase/supabase-js');
const { extractStateFromAddress, assignWSO } = require('./meet-wso-assigner.js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function rebuildAllClubAssignments() {
  console.log('🔄 Rebuilding all club WSO assignments from scratch...');
  console.log('Using the working meet assignment algorithm\n');
  
  try {
    // Get all clubs
    const { data: clubs, error } = await supabase
      .from('clubs')
      .select('club_name, address');
      
    if (error) throw error;
    
    console.log(`Processing ${clubs.length} clubs...`);
    
    let assigned = 0;
    let failed = 0;
    const assignments = [];
    
    for (let i = 0; i < clubs.length; i++) {
      const club = clubs[i];
      
      if (i % 50 === 0) {
        console.log(`  Progress: ${i}/${clubs.length} clubs processed`);
      }
      
      // Try to extract state from address fields (same logic as meets)
      let extractedState = null;
      const addressFields = [club.address].filter(Boolean);
      
      for (const field of addressFields) {
        extractedState = extractStateFromAddress(field);
        if (extractedState) {
          break;
        }
      }
      
      if (extractedState) {
        const wso = assignWSO(extractedState, club.address);
        if (wso) {
          // Update the database
          const { error: updateError } = await supabase
            .from('clubs')
            .update({ wso_geography: wso })
            .eq('club_name', club.club_name);
            
          if (!updateError) {
            assigned++;
            assignments.push({
              club_name: club.club_name,
              address: club.address,
              extracted_state: extractedState,
              assigned_wso: wso
            });
          } else {
            console.error(`Failed to update ${club.club_name}:`, updateError.message);
            failed++;
          }
        } else {
          failed++;
        }
      } else {
        failed++;
      }
    }
    
    console.log(`\n✅ Rebuild complete:`);
    console.log(`  Successfully assigned: ${assigned}`);
    console.log(`  Failed assignments: ${failed}`);
    console.log(`  Assignment rate: ${((assigned/clubs.length)*100).toFixed(1)}%`);
    
    // Show some example assignments
    console.log(`\n📋 Sample assignments:`);
    assignments.slice(0, 10).forEach(assignment => {
      console.log(`  ${assignment.club_name}: ${assignment.extracted_state} → ${assignment.assigned_wso}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

rebuildAllClubAssignments();