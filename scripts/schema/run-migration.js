/**
 * MIGRATION RUNNER
 * Executes a .sql migration file against the self-hosted Supabase database
 * using the authenticated Kong /pg/query endpoint.
 *
 * Usage: node scripts/schema/run-migration.js migrations/create_federation_registry.sql
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

async function runSql(sql) {
    const url = new URL(process.env.SUPABASE_URL);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            port: 443,
            path: '/pg/query',
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': 'Bearer ' + (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
                'Content-Type': 'application/json'
            },
            rejectUnauthorized: false
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify({ query: sql }));
        req.end();
    });
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node scripts/schema/run-migration.js <path-to-sql-file>');
        process.exit(1);
    }

    const resolvedPath = path.resolve(process.cwd(), filePath);
    console.log(`\n============================================================`);
    console.log(`[SQL MIGRATION RUNNER] Running ${path.basename(resolvedPath)}`);
    console.log(`============================================================\n`);

    if (!fs.existsSync(resolvedPath)) {
        console.error(`File not found: ${resolvedPath}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(resolvedPath, 'utf8');
    console.log(`Executing SQL script (${sql.length} bytes)...`);

    try {
        const result = await runSql(sql);
        console.log('✅ Migration executed successfully!');
        if (Array.isArray(result) && result.length > 0) {
            console.log('Result sample:', result.slice(0, 3));
        }
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
}

main();
