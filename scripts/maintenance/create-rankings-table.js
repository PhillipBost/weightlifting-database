const { Client } = require('pg');
require('dotenv').config();

const clientConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
};

const SQL = `
CREATE TABLE IF NOT EXISTS usaw_division_rankings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    result_id BIGINT NOT NULL REFERENCES usaw_meet_results(result_id) ON DELETE CASCADE,
    athlete_id BIGINT NOT NULL REFERENCES usaw_lifters(lifter_id) ON DELETE CASCADE,
    division_name TEXT NOT NULL,
    snatch_rank INTEGER,
    cj_rank INTEGER,
    total_rank INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rankings_athlete_id ON usaw_division_rankings(athlete_id);
CREATE INDEX IF NOT EXISTS idx_rankings_result_id ON usaw_division_rankings(result_id);
CREATE INDEX IF NOT EXISTS idx_rankings_lookup ON usaw_division_rankings(division_name, total_rank);
`;

async function run() {
    console.log('🚀 Starting Database Migration: Create usaw_division_rankings');
    console.log('===========================================================');
    
    if (!process.env.DB_HOST) {
        console.error('❌ Error: DB_HOST not found in environment. Please ensure DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, and DB_PORT are set.');
        process.exit(1);
    }

    const client = new Client(clientConfig);
    try {
        await client.connect();
        console.log('📡 Connected to database.');
        
        console.log('🔨 Executing DDL...');
        await client.query(SQL);
        
        console.log('✅ Migration successful! usaw_division_rankings is ready.');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        if (err.message.includes('relation "usaw_meet_results" does not exist')) {
            console.log('\n💡 Hint: It looks like you are running against a database where tables are not prefixed with "usaw_".');
            console.log('Please verify your environment and table names.');
        }
    } finally {
        await client.end();
    }
}

run();
