const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);

async function verify() {
    console.log('🔍 Verifying IWF Sanctions Data...');

    // 1. Count
    const { count, error: countError } = await supabase.from('iwf_sanctions').select('*', { count: 'exact', head: true });
    if (countError) console.error('Count Error:', countError);
    console.log(`✅ Total Rows: ${count} (Expected: ~853)`);

    // 2. Check for Duplicates
    const { data: dupeData, error: dupeError } = await supabase.rpc('debug_find_duplicates');
    // Note: RPC might not exist, so let's check manually via SQL or just rely on manual query if needed.
    // Let's do a fast JS check since it's small.
    const { data: allRows } = await supabase.from('iwf_sanctions').select('name, start_date, substance');
    const seen = new Set();
    const dupes = [];
    allRows.forEach(r => {
        const sig = `${r.name}|${r.start_date}|${r.substance}`;
        if (seen.has(sig)) dupes.push(r.name);
        seen.add(sig);
    });

    if (dupes.length > 0) {
        console.error(`❌ Found ${dupes.length} duplicates!`, dupes.slice(0, 5));
    } else {
        console.log('✅ No duplicates found.');
    }

    // 3. Check Specific Names
    // YOSLEINYS
    const { data: yos } = await supabase.from('iwf_sanctions').select('name').ilike('name', '%YOSLEINYS%');
    console.log('👀 YOSLEINYS Check:', yos.map(y => y.name));

    // Historical ISA BALA
    const { data: isa } = await supabase.from('iwf_sanctions').select('name, start_date').ilike('name', 'ISA BALA%');
    console.log('👀 Historical Check (ISA BALA):', isa);

}

verify();
