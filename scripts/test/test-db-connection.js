// Load environment variables from .env file when running locally
if (!process.env.GITHUB_ACTIONS) {
    require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js');

async function testDatabaseConnection() {
    console.log('🧪 Testing database connection...');
    console.log('');

    // Log environment variables (sanitized)
    console.log('Environment Variables:');
    console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
    console.log('  SUPABASE_SECRET_KEY:', process.env.SUPABASE_SECRET_KEY ? `SET (${process.env.SUPABASE_SECRET_KEY.length} chars)` : 'MISSING');
    console.log('');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
        console.error('❌ Missing required environment variables');
        process.exit(1);
    }

    // Initialize Supabase client
    console.log('Initializing Supabase client...');
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET_KEY
    );
    console.log('✅ Client initialized');
    console.log('');

    // Test 1: Read from existing table
    console.log('Test 1: Reading from usaw_lifters table...');
    const { data: lifters, error: readError, count } = await supabase
        .from('usaw_lifters')
        .select('lifter_id', { count: 'exact', head: true });

    if (readError) {
        console.error('❌ Read test FAILED:', readError.message);
        console.error('   Error details:', readError);
        process.exit(1);
    }
    console.log(`✅ Read test PASSED - Found ${count} lifters in database`);
    console.log('');

    // Test 2: Write to test table
    console.log('Test 2: Writing to test_github_actions table...');
    const testData = {
        test_source: process.env.GITHUB_ACTIONS ? 'github_actions' : 'local',
        test_data: {
            timestamp: new Date().toISOString(),
            runner: process.env.RUNNER_NAME || 'local',
            workflow: process.env.GITHUB_WORKFLOW || 'n/a'
        }
    };

    const { data: inserted, error: insertError } = await supabase
        .from('test_github_actions')
        .insert(testData)
        .select();

    if (insertError) {
        console.error('❌ Write test FAILED:', insertError.message);
        console.error('   Error details:', insertError);
        process.exit(1);
    }
    console.log('✅ Write test PASSED - Inserted record:', inserted[0].id);
    console.log('');

    // Test 3: Verify write by reading back
    console.log('Test 3: Verifying written data...');
    const { data: verified, error: verifyError } = await supabase
        .from('test_github_actions')
        .select('*')
        .eq('id', inserted[0].id)
        .single();

    if (verifyError) {
        console.error('❌ Verify test FAILED:', verifyError.message);
        process.exit(1);
    }
    console.log('✅ Verify test PASSED - Read back:', verified);
    console.log('');

    // Test 4: Update test
    console.log('Test 4: Updating record...');
    const { error: updateError } = await supabase
        .from('test_github_actions')
        .update({ test_data: { ...verified.test_data, updated: true } })
        .eq('id', inserted[0].id);

    if (updateError) {
        console.error('❌ Update test FAILED:', updateError.message);
        process.exit(1);
    }
    console.log('✅ Update test PASSED');
    console.log('');

    console.log('🎉 All tests PASSED - Database connection fully functional');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Check test_github_actions table in database to verify record exists');
    console.log('  2. Compare local vs GitHub Actions results');
    console.log('  3. If GitHub Actions fails, review error messages above');
}

testDatabaseConnection().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
});
