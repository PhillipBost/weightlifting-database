const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments, runTable, runPlan } = require('../scripts/maintenance/backfill_gamx_scores_batched');

function report(overrides = {}) {
    return {
        table: 'usaw_meet_results', mode: 'preview', upper_id: '9007199254740995',
        last_id: '9007199254740993', examined: 1, candidates: 1, updated: 0,
        unchanged: 0, skipped_count: 0, skipped: [], examples: [], changed_fields: {},
        complete: false, ...overrides
    };
}

test('defaults to a read-only preview and validates restart boundaries', () => {
    assert.deepEqual(parseArguments([]), {
        mode: 'preview', table: 'all', fromTable: null, batchSize: 100, after: null, through: null
    });
    assert.throws(() => parseArguments(['--apply', '--preview']), /Choose either/);
    assert.throws(() => parseArguments(['--after', '5']), /provided together/);
    assert.throws(() => parseArguments(['--table', 'iwf', '--after', '6', '--through', '5']), /cannot exceed/);
    assert.throws(() => parseArguments(['--batch-size', '0']), /between 1 and 1000/);
    assert.throws(() => parseArguments(['--from-table', 'iwf']), /requires --apply/);
    assert.equal(parseArguments(['--apply', '--from-table', 'iwf', '--after', '5', '--through', '10']).fromTable, 'iwf');
});

test('preview executes exactly one read-only batch', async () => {
    const calls = [];
    const client = { rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: report(), error: null };
    } };
    await runTable(client, 'usaw', parseArguments([]), { log() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_apply, false);
    assert.equal(calls[0].args.p_batch_size, 100);
});

test('apply processes sequential batches with exact large identifiers', async () => {
    const calls = [];
    const client = { rpc: async (name, args) => {
        calls.push(args);
        if (calls.length === 1) return {
            data: report({ mode: 'apply', updated: 1 }), error: null
        };
        return {
            data: report({
                mode: 'apply', last_id: '9007199254740995',
                candidates: 0, updated: 0, unchanged: 1, complete: true
            }),
            error: null
        };
    } };
    const logs = [];
    await runTable(client, 'usaw', parseArguments(['--apply']), { log: value => logs.push(value) });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].p_after_id, '9007199254740993');
    assert.equal(calls[1].p_upper_id, '9007199254740995');
    assert(logs.some(line => line.includes('--after 9007199254740993')));
    assert(logs.some(line => line.includes('--table all --from-table usaw')));
});

test('a failed request stops without retrying and warns of an uncertain outcome', async () => {
    let calls = 0;
    const client = { rpc: async () => {
        calls++;
        throw new Error('connection lost');
    } };
    await assert.rejects(
        runTable(client, 'usaw', parseArguments(['--apply']), { log() {} }),
        /may have committed/
    );
    assert.equal(calls, 1);
});

test('a non-advancing or inconsistent batch report stops processing', async () => {
    const client = { rpc: async () => ({
        data: report({ examined: 0, candidates: 0, last_id: null }), error: null
    }) };
    await assert.rejects(
        runTable(client, 'usaw', parseArguments([]), { log() {} }),
        /did not advance/
    );
});

test('resuming all tables continues with a fresh boundary on the next table', async () => {
    const calls = [];
    const client = { rpc: async (name, args) => {
        calls.push(args);
        return { error: null, data: report({
            table: args.p_table, mode: 'apply',
            upper_id: args.p_upper_id || '30', last_id: args.p_upper_id || '30',
            updated: 1, complete: true
        }) };
    } };
    const options = parseArguments(['--apply', '--from-table', 'iwf', '--after', '11', '--through', '20']);
    await runPlan(client, options, { log() {} });
    assert.deepEqual(calls.map(call => call.p_table), ['iwf_meet_results', 'owlcms_meet_results']);
    assert.equal(calls[0].p_after_id, '11');
    assert.equal(calls[0].p_upper_id, '20');
    assert.equal(calls[1].p_after_id, null);
    assert.equal(calls[1].p_upper_id, null);
});

test('skipped result identifiers and reasons are reported', async () => {
    const client = { rpc: async () => ({ error: null, data: report({
        candidates: 0, skipped_count: 1,
        skipped: [{ id: '9007199254740993', reason: 'missing body weight' }], complete: true
    }) }) };
    const logs = [];
    await runTable(client, 'usaw', parseArguments([]), { log: value => logs.push(value) });
    assert(logs.some(line => line.includes('missing body weight')));
    assert(logs.some(line => line.includes('9007199254740993')));
});
