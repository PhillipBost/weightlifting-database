#!/usr/bin/env node
/**
 * Clear IWF database tables for fresh start
 *
 * Truncates:
 * - iwf_meets
 * - iwf_meet_locations
 * - iwf_lifters
 * - iwf_meet_results
 *
 * Usage: node scripts/maintenance/clear-iwf-database.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_IWF_URL;
const supabaseKey = process.env.SUPABASE_IWF_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_IWF_URL or SUPABASE_IWF_SECRET_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearDatabase() {
  console.log('🗑️  Clearing IWF Database Tables');
  console.log('='.repeat(80));

  // Map table names to their primary key columns
  const tables = {
    'iwf_meet_results': 'db_result_id',
    'iwf_meet_entries': 'id',
    'iwf_lifters': 'db_lifter_id',
    'iwf_meet_locations': 'db_location_id',
    'iwf_meets': 'db_meet_id'
  };

  let totalDeleted = 0;

  try {
    for (const [table, primaryKeyColumn] of Object.entries(tables)) {
      console.log(`\nClearing ${table}...`);

      // Get count before deletion
      const { count: countBefore } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (countBefore > 0) {
        console.log(`  Records before: ${countBefore}`);

        // Delete in batches by fetching IDs first
        const BATCH_SIZE = 50; // Smaller batches
        let deletedInTable = 0;
        let batchCount = 0;

        while (true) {
          const { count: currentCount } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });

          if (currentCount === 0) break;

          // Fetch a batch of IDs to delete
          const { data: rowsToDelete, error: fetchError } = await supabase
            .from(table)
            .select(primaryKeyColumn, { count: 'exact' })
            .limit(BATCH_SIZE);

          if (fetchError) {
            console.error(`  ❌ Fetch error: ${fetchError.message}`);
            throw fetchError;
          }

          if (!rowsToDelete || rowsToDelete.length === 0) break;

          // Extract IDs from the fetched rows
          const idsToDelete = rowsToDelete.map(r => r[primaryKeyColumn]);

          // Delete records by primary key
          const { error } = await supabase
            .from(table)
            .delete()
            .in(primaryKeyColumn, idsToDelete.slice(0, BATCH_SIZE));

          if (error) {
            console.error(`  ❌ Error: ${error.message}`);
            throw error;
          }

          batchCount += 1;
          deletedInTable += rowsToDelete.length;
          const pct = Math.round((deletedInTable / countBefore) * 100);
          console.log(`  Batch ${batchCount}: deleted ${rowsToDelete.length} records (${deletedInTable}/${countBefore} - ${pct}%)`);

          // Small delay between batches to avoid overwhelming the database
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Verify deletion
        const { count: countAfter } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        console.log(`  ✓ Cleared: ${countBefore} records deleted`);
        console.log(`  Records remaining: ${countAfter}`);
        totalDeleted += countBefore;
      } else {
        console.log(`  (already empty)`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✓ Database cleared successfully`);
    console.log(`Total records deleted: ${totalDeleted}`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Database clear failed:');
    console.error(error.message);
    console.error('='.repeat(80));
    process.exit(1);
  }
}

clearDatabase();
