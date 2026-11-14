const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const GENERATOR = path.join(__dirname, 'generate_gamx_factor_update.py');
const TABLES = {
    gamx_u_update: { table: 'gamx_u_factors_candidate', age: true, count: 43428 },
    gamx_points_update: { table: 'gamx_points_factors_candidate', age: false, count: 3002 },
    gamx_ms_factors: { table: 'gamx_ms_factors_candidate', age: true, count: 190627 },
    gamx_mj_factors: { table: 'gamx_mj_factors_candidate', age: true, count: 190627 }
};
const PAGE_SIZE = 1000;
const PYTHON_EXTRACTOR = `
import contextlib, importlib.util, json, sys
spec = importlib.util.spec_from_file_location('gamx_generator', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with contextlib.redirect_stdout(sys.stderr):
    data = module.read_sources()
for source, rows in data.items():
    for key, factors in rows:
        print(json.dumps([source, list(key[:-1]) + [str(key[-1])], [str(v) for v in factors]]))
`;

function rowKey(row, hasAge) {
    const weight = Number(row.bodyweight);
    if (!Number.isFinite(weight) || Math.abs(weight * 10 - Math.round(weight * 10)) > 1e-8) {
        throw new Error('Candidate row has invalid bodyweight');
    }
    return hasAge
        ? `${row.gender}|${row.age}|${weight.toFixed(1)}`
        : `${row.gender}|${weight.toFixed(1)}`;
}

function sameFactors(actual, expected) {
    return ['mu', 'sigma', 'nu'].every(field => {
        const a = Number(actual[field]);
        const b = Number(expected[field]);
        return Number.isFinite(a) && Number.isFinite(b)
            && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
    });
}

async function readWorkbookFactors() {
    const child = spawn('python', ['-c', PYTHON_EXTRACTOR, GENERATOR], {
        cwd: ROOT,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['ignore', 'pipe', 'inherit']
    });
    const finished = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`Workbook validation failed (Python exit code ${code})`));
        });
    });
    const rowsBySource = Object.fromEntries(
        Object.keys(TABLES).map(source => [source, new Map()])
    );
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
        const [source, key, factors] = JSON.parse(line);
        const config = TABLES[source];
        if (!config) throw new Error(`Unknown factor source: ${source}`);
        const row = {
            gender: key[0],
            bodyweight: key[config.age ? 2 : 1],
            mu: factors[0],
            sigma: factors[1],
            nu: factors[2]
        };
        if (config.age) row.age = key[1];
        const lookup = rowKey(row, config.age);
        if (rowsBySource[source].has(lookup)) throw new Error(`Duplicate workbook key: ${source} ${lookup}`);
        rowsBySource[source].set(lookup, row);
    }
    await finished;
    for (const [source, config] of Object.entries(TABLES)) {
        const count = rowsBySource[source].size;
        if (count !== config.count) throw new Error(`${source}: expected ${config.count} factors, found ${count}`);
        console.log(`${config.table}: ${count} workbook factors validated`);
    }
    return rowsBySource;
}

async function inspectTable(client, config, expected) {
    const seen = new Set();
    let offset = 0;
    for (;;) {
        let query = client.from(config.table)
            .select(config.age ? 'gender,age,bodyweight,mu,sigma,nu' : 'gender,bodyweight,mu,sigma,nu')
            .order('gender', { ascending: true });
        if (config.age) query = query.order('age', { ascending: true });
        const { data, error } = await query.order('bodyweight', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error(`${config.table}: read failed: ${error.message}`);
        if (!data) throw new Error(`${config.table}: read returned no data`);
        if (data.length === 0) break;
        for (const row of data) {
            const key = rowKey(row, config.age);
            if (seen.has(key)) throw new Error(`${config.table}: duplicate or unstable result for ${key}`);
            const match = expected.get(key);
            if (!match) throw new Error(`${config.table}: unexpected candidate key ${key}`);
            if (!sameFactors(row, match)) throw new Error(`${config.table}: conflicting factors for ${key}`);
            seen.add(key);
        }
        offset += data.length;
    }
    return seen;
}

async function loadCandidates(client, rowsBySource) {
    const existing = {};
    for (const [source, config] of Object.entries(TABLES)) {
        existing[source] = await inspectTable(client, config, rowsBySource[source]);
        console.log(`${config.table}: ${existing[source].size} existing rows match`);
    }

    for (const [source, config] of Object.entries(TABLES)) {
        const pending = [...rowsBySource[source].entries()]
            .filter(([key]) => !existing[source].has(key))
            .map(([, row]) => row);
        for (let offset = 0; offset < pending.length; offset += PAGE_SIZE) {
            const batch = pending.slice(offset, offset + PAGE_SIZE);
            const { error } = await client.from(config.table).insert(batch);
            if (error) {
                throw new Error(`${config.table}: insert failed at batch ${offset}: ${error.message}`);
            }
            console.log(`${config.table}: inserted ${Math.min(offset + batch.length, pending.length)} of ${pending.length}`);
        }
    }

    for (const [source, config] of Object.entries(TABLES)) {
        const actual = await inspectTable(client, config, rowsBySource[source]);
        if (actual.size !== config.count) {
            throw new Error(`${config.table}: verification found ${actual.size} of ${config.count} rows`);
        }
        console.log(`${config.table}: verified ${actual.size} candidate rows`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--load') || args.length > 1) {
        throw new Error('Usage: node scripts\\utils\\load_gamx_candidates.js [--load]');
    }
    const rows = await readWorkbookFactors();
    if (!args.includes('--load')) {
        console.log('Dry run complete. No database connection was made.');
        return;
    }

    require('dotenv').config({ path: path.join(ROOT, '.env') });
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
        || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('Missing Supabase URL or service key');
    const { createClient } = require('@supabase/supabase-js');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await loadCandidates(client, rows);
    console.log('Candidate loading and factor verification complete.');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Candidate loading failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { rowKey, sameFactors, inspectTable, loadCandidates };
