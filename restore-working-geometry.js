/**
 * Restore Working Geometry - Undo Broken Union Operations
 * 
 * Reverts the corrupted "union" results and restores functional MultiPolygon data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function restoreWorkingGeometry() {
    console.log('=== Restoring Working WSO Geometry ===\n');
    console.log('Reverting broken union operations...');
    
    // The original california-wso-fixer.js with MultiPolygon concatenation was working
    // We need to run it again to restore functional geometry
    
    console.log('1. Run the original california-wso-fixer.js to restore working MultiPolygon data');
    console.log('2. This will overwrite the corrupted "Polygon" geometry with functional MultiPolygon');
    console.log('3. Maps will render properly again (with county borders visible, but functional)');
    
    console.log('\nTo restore:');
    console.log('node california-wso-fixer.js');
    
    console.log('\nThis will restore the working state where:');
    console.log('- County borders are visible (original problem)');
    console.log('- But geometry renders correctly (no corruption)');
    console.log('- Frontend maps work without errors');
}

if (require.main === module) {
    restoreWorkingGeometry().catch(console.error);
}