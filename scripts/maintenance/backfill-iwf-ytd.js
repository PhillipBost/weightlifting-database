#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const minimist = require('minimist');

const supabaseIWF = createClient(
    process.env.SUPABASE_IWF_URL,
    process.env.SUPABASE_IWF_SECRET_KEY
);

const argv = minimist(process.argv.slice(2));
const FILTER_YEAR = argv.year ? parseInt(argv.year) : null;
const LIMIT = argv.limit ? parseInt(argv.limit) : null;
const BATCH_SIZE = 100;
const DELAY_MS = 500;

async function getResultsToBackfill() {
    console.log('Fetching IWF meet results to backfill...');
    
    if (FILTER_YEAR) {
        console.log(`Filtering by year: ${FILTER_YEAR}`);
    }
    
    let query = supabaseIWF
        .from('iwf_meet_results')
        .select('result_id, db_lifter_id, date', { count: 'exact' });
    
    if (FILTER_YEAR) {
        const startDate = `${FILTER_YEAR}-01-01`;
        const endDate = `${FILTER_YEAR}-12-31`;
        query = query.gte('date', startDate).lte('date', endDate);
    }
    
    if (LIMIT) {
        query = query.limit(LIMIT);
        console.log(`LIMIT APPLIED: Processing only ${LIMIT} records`);
    }
    
    const { data, count, error } = await query.order('date', { ascending: true });
    
    if (error) {
        throw new Error(`Failed to fetch results: ${error.message}`);
    }
    
    console.log(`Found ${data.length} records to backfill (total available: ${count})`);
    return { results: data, totalCount: count };
}

async function triggerYTDRecalculation(resultId) {
    const { error } = await supabaseIWF
        .from('iwf_meet_results')
        .update({ updated_at: new Date().toISOString() })
        .eq('result_id', resultId);
    
    if (error) {
        console.error(`Failed to update record ${resultId}: ${error.message}`);
        return false;
    }
    
    return true;
}

async function backfillYTDForBatch(resultIds, batchNumber, totalBatches) {
    console.log(`\nProcessing batch ${batchNumber}/${totalBatches} (${resultIds.length} records)`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < resultIds.length; i++) {
        const resultId = resultIds[i];
        
        try {
            const success = await triggerYTDRecalculation(resultId);
            if (success) {
                successCount++;
            } else {
                errorCount++;
            }
            
            if ((i + 1) % 10 === 0) {
                console.log(`  Progress: ${i + 1}/${resultIds.length}`);
            }
            
            if (i < resultIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            
        } catch (error) {
            console.error(`Error for record ${resultId}: ${error.message}`);
            errorCount++;
        }
    }
    
    console.log(`  Batch complete: ${successCount} succeeded, ${errorCount} failed`);
    return { successCount, errorCount };
}

async function main() {
    console.log('\n' + '='.repeat(80));
    console.log('IWF YTD BACKFILL SCRIPT');
    console.log('='.repeat(80));
    console.log(`Started: ${new Date().toLocaleString()}\n`);
    
    const startTime = Date.now();
    
    try {
        console.log('Testing IWF database connection...');
        const { error: connError } = await supabaseIWF
            .from('iwf_meet_results')
            .select('count')
            .limit(1);
        
        if (connError) {
            throw new Error(`Database connection failed: ${connError.message}`);
        }
        console.log('Connection successful\n');
        
        const { results } = await getResultsToBackfill();
        
        if (results.length === 0) {
            console.log('No records to process');
            return;
        }
        
        console.log(`Processing ${results.length} records in batches of ${BATCH_SIZE}...\n`);
        
        const resultIds = results.map(r => r.result_id);
        const batches = [];
        
        for (let i = 0; i < resultIds.length; i += BATCH_SIZE) {
            batches.push(resultIds.slice(i, i + BATCH_SIZE));
        }
        
        let totalSuccess = 0;
        let totalErrors = 0;
        
        for (let i = 0; i < batches.length; i++) {
            const batchResult = await backfillYTDForBatch(batches[i], i + 1, batches.length);
            totalSuccess += batchResult.successCount;
            totalErrors += batchResult.errorCount;
            
            if (i < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\n' + '='.repeat(80));
        console.log('BACKFILL SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total records processed: ${totalSuccess + totalErrors}`);
        console.log(`Successful updates: ${totalSuccess}`);
        console.log(`Failed updates: ${totalErrors}`);
        console.log(`Execution time: ${elapsed}s`);
        console.log(`Completed: ${new Date().toLocaleString()}`);
        console.log('='.repeat(80) + '\n');
        
        if (totalErrors > 0) {
            console.log(`${totalErrors} record(s) failed. Check logs above for details.`);
            process.exit(1);
        } else {
            console.log('All records processed successfully!');
            console.log('YTD best values have been recalculated for all records.');
            process.exit(0);
        }
        
    } catch (error) {
        console.error('\nBACKFILL FAILED:', error.message);
        console.error('Stack trace:', error.stack);
        console.log('\nTroubleshooting:');
        console.log('1. Verify SUPABASE_IWF_URL and SUPABASE_IWF_SECRET_KEY are set');
        console.log('2. Check network connectivity to Supabase');
        console.log('3. Verify iwf_meet_results table exists');
        console.log('4. Verify calculate_iwf_ytd_bests() trigger exists');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    triggerYTDRecalculation,
    backfillYTDForBatch
};