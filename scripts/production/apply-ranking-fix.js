require('dotenv').config({ path: 'c:/Users/PB/Desktop/Bost Laboratory Services/Weightlifting/weightlifting-database/.env' });
const fs = require('fs');
const https = require('https');
const path = require('path');

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

async function applyMigration() {
    console.log('Applying migrations/fix_search_federations_ranking.sql to database...\n');
    const sqlPath = path.join(__dirname, '../../migrations/fix_search_federations_ranking.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    const result = await runSql(sql);
    console.log('Migration successfully applied!', result);
}

applyMigration().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
