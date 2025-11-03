#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const minimist = require('minimist');
require('dotenv').config();

const supabaseIWF = createClient(
    process.env.SUPABASE_IWF_URL,
    process.env.SUPABASE_IWF_SECRET_KEY
);

const argv = minimist(process.argv.slice(2));
const FILTER_YEAR = argv.year ? parseInt(argv.year) : null;
const LIMIT = argv.limit ? parseInt(argv.limit) : null;
const ALL = argv.all;
const BATCH_SIZE = 100;
const DELAY_MS = 500;

async function getResultsToBackfill() {
    console.log('Fetching IWF meet results to backfill...');
    
    if (FILTER_YEAR) {
        console.log(`Filtering by year: ${FILTER_YEAR}`);
    }
    
    // Build base query for count
    let countQuery = supabaseIWF
        .from('iwf_meet_results');
    
    if (FILTER_YEAR) {
        const startDate = `${FILTER_YEAR}-01-01`;
        const endDate = `${FILTER_YEAR}-12-31`;
        countQuery = countQuery.gte('date', startDate).lte('date', endDate);
    }
    
    // Get total count
    const { count, error: countError } = await countQuery.select('*', { count: 'exact', head: true });
    if (countError) {
        throw new Error(`Failed to get count: ${countError.message}`);
    }
    if (count === null || count === undefined) {
        throw new Error('Count not returned from query');
    }
    
    console.log(`Total records available: ${count}`);
    
    // Build base query for data (with select, no count option)
    let dataQuery = supabaseIWF
        .from('iwf_meet_results')
        .select('db_result_id, db_lifter_id, date');
    
    if (FILTER_YEAR) {
        const startDate = `${FILTER_YEAR}-01-01`;
        const endDate = `${FILTER_YEAR}-12-31`;
        dataQuery = dataQuery.gte('date', startDate).lte('date', endDate);
    }
    
    let data;
    if (ALL && LIMIT === null) {
        console.log(`Fetching ALL ${count} records via pagination...`);
        data = [];
        let offset = 0;
        const pageSize = 1000;
        while (offset < count) {
            const end = Math.min(offset + pageSize - 1, count - 1);
            const pageQuery = dataQuery
                .range(offset, end);
            const { data: pageData, error: pageError } = await pageQuery;
            if (pageError) {
                throw new Error(`Failed to fetch page at offset ${offset}: ${pageError.message}`);
            }
            console.log(`Fetched page at offset ${offset}: ${pageData.length} records`);
            if (pageData.length === 0) {
                console.warn(`Warning: Empty page at offset ${offset}, stopping pagination`);
                break;
            }
            data = data.concat(pageData);
            offset += pageSize;
        }
        // Sort by date ascending in JS
        data.sort((a, b) => a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : 1);
        console.log(`Fetched and sorted ${data.length} records via pagination`);
    } else if (LIMIT !== null) {
        const limitedQuery = dataQuery.limit(LIMIT).order('date', { ascending: true });
        console.log(`LIMIT APPLIED: Processing only ${LIMIT} records`);
        const { data: limitedData, error } = await limitedQuery;
        if (error) {
            throw new Error(`Failed to fetch limited results: ${error.message}`);
        }
        data = limitedData;
    } else {
        // Default to first 1000
        const defaultLimit = 1000;
        const defaultQuery = dataQuery.limit(defaultLimit).order('date', { ascending: true });
        console.log(`Applying default limit of ${defaultLimit} records (total available: ${count})`);
        const { data: defaultData, error } = await defaultQuery;
        if (error) {
            throw new Error(`Failed to fetch default results: ${error.message}`);
        }
        data = defaultData;
    }
    
    console.log(`Found ${data.length} records to backfill (total available: ${count})`);
    return { results: data, totalCount: count };
}

async function triggerYTDRecalculation(resultId) {
    const { error } = await supabaseIWF
        .from('iwf_meet_results')
        .update({ updated_at: new Date().toISOString() })
        .eq('db_result_id', resultId);
    
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

/**
 * Backfill YTD for specific lifters in a specific year
 * Used by orchestrator for targeted backfill after imports
 * @param {number} year - Year to backfill
 * @param {Array<number>} lifterIds - Array of db_lifter_id values to backfill
 * @returns {Object} - { success: number, errors: number }
 */
async function backfillYTDForLiftersInYear(year, lifterIds) {
    if (!lifterIds || lifterIds.length === 0) {
        return { success: 0, errors: 0 };
    }

    try {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        // Query results for these lifters in this year
        const { data: results, error } = await supabaseIWF
            .from('iwf_meet_results')
            .select('db_result_id')
            .in('db_lifter_id', lifterIds)
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: true });

        if (error) {
            throw new Error(`Failed to query lifter results: ${error.message}`);
        }

        if (!results || results.length === 0) {
            return { success: 0, errors: 0 };
        }

        const resultIds = results.map(r => r.db_result_id);
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

        return { success: totalSuccess, errors: totalErrors };

    } catch (error) {
        console.error(`Error backfilling lifters for year ${year}:`, error.message);
        throw error;
    }
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
        
        // Filter out invalid records
        const validResults = results.filter(r => r.db_result_id !== undefined && r.db_result_id !== null);
        if (validResults.length !== results.length) {
            console.warn(`Filtered out ${results.length - validResults.length} records with invalid db_result_id`);
        }
        
        console.log(`Processing ${validResults.length} valid records in batches of ${BATCH_SIZE}...\n`);
        
        const resultIds = validResults.map(r => r.db_result_id);
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
    backfillYTDForBatch,
    backfillYTDForLiftersInYear
};
