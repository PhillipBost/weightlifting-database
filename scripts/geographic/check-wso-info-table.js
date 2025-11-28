const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkWSOInfoTable() {
    console.log('📋 Checking wso_information table...');

    try {
        // First get a sample to see the structure
        const { data: sample, error: sampleError } = await supabase
            .from('usaw_wso_information')
            .select('*')
            .limit(3);

        if (sampleError) {
            console.error('Error:', sampleError.message);
            return;
        }

        if (sample && sample.length > 0) {
            console.log('Table columns:', Object.keys(sample[0]));
            console.log('\nSample records:');
            sample.forEach((record, index) => {
                console.log(`${index + 1}.`, record);
            });

            // Now get all records
            const { data: allWSOs, error: allError } = await supabase
                .from('usaw_wso_information')
                .select('*');

            if (!allError && allWSOs) {
                console.log(`\nTotal WSO records: ${allWSOs.length}`);
                console.log('\nAll WSO records:');
                allWSOs.forEach((wso, index) => {
                    console.log(`${index + 1}.`, wso);
                });
            }
        } else {
            console.log('No records found in wso_information table');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkWSOInfoTable();