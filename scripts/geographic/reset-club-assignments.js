const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function resetAllClubAssignments() {
  console.log('🔄 Resetting all club WSO assignments to null...');
  
  try {
    const { error } = await supabase
      .from('clubs')
      .update({ wso_geography: null })
      .neq('wso_geography', null);
      
    if (error) {
      console.error('Error:', error.message);
      return;
    }
    
    console.log('✅ All club WSO assignments have been reset to null');
    
    // Verify the reset
    const { data: checkData, error: checkError } = await supabase
      .from('clubs')
      .select('wso_geography')
      .not('wso_geography', 'is', null);
      
    if (checkError) {
      console.error('Error checking:', checkError.message);
      return;
    }
    
    console.log(`Remaining non-null assignments: ${checkData.length}`);
    
  } catch (error) {
    console.error('Exception:', error.message);
  }
}

resetAllClubAssignments();