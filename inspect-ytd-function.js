const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_IWF_URL, process.env.SUPABASE_IWF_SECRET_KEY);

async function inspectFunction() {
  // Query to get function source
  const { data, error } = await supabase.rpc('get_function_source', { func_name: 'calculate_iwf_ytd_bests' });
  
  if (error) {
    console.log('Error fetching function source:', error);
    return;
  }
  
  console.log('Function source for calculate_iwf_ytd_bests:');
  console.log(data);
}

// Create the RPC function if not exists
const createRpc = `
CREATE OR REPLACE FUNCTION get_function_source(func_name text)
RETURNS text AS $$
BEGIN
  RETURN (SELECT prosrc FROM pg_proc WHERE proname = func_name);
EXCEPTION WHEN OTHERS THEN
  RETURN 'Function not found or error: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql;
`;

supabase.rpc('create_get_function_source').then(() => {
  inspectFunction();
}).catch(console.error);
