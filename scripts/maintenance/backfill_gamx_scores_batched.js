const TABLES = {
    usaw: 'usaw_meet_results',
    iwf: 'iwf_meet_results',
    owlcms: 'owlcms_meet_results'
};

function parseInteger(value, name) {
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
        throw new Error(`${name} must be an integer`);
    }
    const number = BigInt(value);
    if (number < -9223372036854775808n || number > 9223372036854775807n) {
        throw new Error(`${name} is outside the database integer range`);
    }
    return number.toString();
}

function parseArguments(args) {
    const options = {
        mode: 'preview', table: 'all', fromTable: null, batchSize: 100, after: null, through: null
    };
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--preview' || arg === '--apply') {
            if (seen.has('mode')) throw new Error('Choose either --preview or --apply once');
            seen.add('mode');
            options.mode = arg.slice(2);
            continue;
        }
        if (!['--table', '--from-table', '--batch-size', '--after', '--through'].includes(arg)) {
            throw new Error(`Unknown argument: ${arg}`);
        }
        if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
        seen.add(arg);
        const value = args[++i];
        if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
        if (arg === '--table') {
            if (value !== 'all' && !Object.hasOwn(TABLES, value)) throw new Error(`Unknown table: ${value}`);
            options.table = value;
        } else if (arg === '--from-table') {
            if (!Object.hasOwn(TABLES, value)) throw new Error(`Unknown starting table: ${value}`);
            options.fromTable = value;
        } else if (arg === '--batch-size') {
            const parsed = parseInteger(value, arg);
            if (BigInt(parsed) < 1n || BigInt(parsed) > 1000n) {
                throw new Error('--batch-size must be between 1 and 1000');
            }
            options.batchSize = Number(parsed);
        } else if (arg === '--after') {
            options.after = parseInteger(value, arg);
        } else {
            options.through = parseInteger(value, arg);
        }
    }
    if ((options.after === null) !== (options.through === null)) {
        throw new Error('--after and --through must be provided together');
    }
    if (options.fromTable !== null && (options.table !== 'all' || options.mode !== 'apply')) {
        throw new Error('--from-table requires --apply with --table all');
    }
    if (options.after !== null && options.table === 'all' && options.fromTable === null) {
        throw new Error('A restart point with --table all requires --from-table');
    }
    if (options.after !== null && BigInt(options.after) > BigInt(options.through)) {
        throw new Error('--after cannot exceed --through');
    }
    return options;
}

function validateBatch(result, table, apply, batchSize, previous, upper) {
    if (!result || typeof result !== 'object' || result.table !== TABLES[table] ||
        result.mode !== (apply ? 'apply' : 'preview') ||
        !Number.isInteger(result.examined) || result.examined < 0 || result.examined > batchSize ||
        !Number.isInteger(result.candidates) || result.candidates < 0 ||
        !Number.isInteger(result.updated) || result.updated < 0 ||
        !Number.isInteger(result.unchanged) || result.unchanged < 0 ||
        !Number.isInteger(result.skipped_count) || result.skipped_count < 0 ||
        typeof result.complete !== 'boolean' || !Array.isArray(result.skipped) ||
        !Array.isArray(result.examples) || !result.changed_fields ||
        typeof result.changed_fields !== 'object') {
        throw new Error('Database returned an invalid batch report');
    }
    if (result.examined !== result.candidates + result.unchanged + result.skipped_count ||
        result.skipped.length !== result.skipped_count ||
        result.updated !== (apply ? result.candidates : 0)) {
        throw new Error('Database returned inconsistent batch counts');
    }
    const last = result.last_id === null ? null : parseInteger(result.last_id, 'last_id');
    const boundary = result.upper_id === null ? null : parseInteger(result.upper_id, 'upper_id');
    if (upper !== null && boundary !== upper) throw new Error('Database changed the upper boundary');
    if (result.examined > 0 && (last === null || boundary === null ||
        (previous !== null && BigInt(last) <= BigInt(previous)) ||
        BigInt(last) > BigInt(boundary))) {
        throw new Error('Database returned an invalid restart point');
    }
    if (!result.complete && (result.examined === 0 || last === null)) {
        throw new Error('Database did not advance the batch cursor');
    }
    return { last, boundary };
}

async function runTable(client, table, options, log = console) {
    let after = options.after;
    let upper = options.through;
    let totalUpdated = 0;
    const apply = options.mode === 'apply';
    while (true) {
        let response;
        try {
            response = await client.rpc('backfill_gamx_scores_batched', {
                p_table: TABLES[table],
                p_after_id: after,
                p_upper_id: upper,
                p_batch_size: options.batchSize,
                p_apply: apply
            });
        } catch (error) {
            throw new Error(`Batch request failed for ${table} after ${after}; the batch may have committed. Inspect the database before resuming: ${error.message}`);
        }
        if (!response || typeof response !== 'object') {
            throw new Error(`Invalid response for ${table} after ${after}; the batch may have committed. Inspect the database before resuming.`);
        }
        if (response.error) {
            throw new Error(`Batch failed for ${table} after ${after}; confirm its outcome before resuming: ${response.error.message}`);
        }
        let last;
        let boundary;
        try {
            ({ last, boundary } = validateBatch(
                response.data, table, apply, options.batchSize, after, upper
            ));
        } catch (error) {
            throw new Error(`Invalid batch response for ${table} after ${after}; the batch may have committed. Inspect the database before resuming: ${error.message}`);
        }
        upper = boundary;
        after = last;
        totalUpdated += response.data.updated;
        log.log(JSON.stringify(response.data));
        if (apply && after !== null && upper !== null) {
            const selection = options.table === 'all'
                ? `--table all --from-table ${table}`
                : `--table ${table}`;
            log.log(`Restart: node scripts\\maintenance\\backfill_gamx_scores_batched.js --apply ${selection} --after ${after} --through ${upper} --batch-size ${options.batchSize}`);
        }
        if (!apply || response.data.complete) break;
    }
    log.log(`${table}: ${apply ? `updated ${totalUpdated} results` : 'previewed one batch; no results updated'}`);
}

async function runPlan(client, options, log = console) {
    let tables = options.table === 'all' ? Object.keys(TABLES) : [options.table];
    if (options.fromTable !== null) tables = tables.slice(tables.indexOf(options.fromTable));
    if (options.mode === 'apply') {
        log.log('Applying sequential batches. Earlier successful batches remain committed if a later batch fails.');
        log.log('Result triggers may update calculated fields, timestamps, meet counts, queues, and published athlete files.');
    } else {
        log.log('Read-only preview: one batch per selected table. Trigger side effects are not simulated.');
    }
    for (const table of tables) {
        const tableOptions = table === options.fromTable || options.table !== 'all'
            ? options
            : { ...options, after: null, through: null };
        await runTable(client, table, tableOptions, log);
    }
}

async function main(args) {
    const options = parseArguments(args);
    require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL or service-role key');
    const { createClient } = require('@supabase/supabase-js');
    await runPlan(createClient(url, key), options);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { parseArguments, validateBatch, runTable, runPlan };
