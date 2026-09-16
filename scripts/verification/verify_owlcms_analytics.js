const path = require('path');
const projectRoot = path.resolve(__dirname, '../..');
require(path.join(projectRoot, 'node_modules/dotenv')).config({ path: path.join(projectRoot, '.env') });
const { createClient } = require(path.join(projectRoot, 'node_modules/@supabase/supabase-js'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function verify() {
  console.log('🔍 Checking OWLCMS analytics columns and values...\n');

  const { data, error } = await supabase
    .from('owlcms_meet_results')
    .select(`
      result_id,
      category,
      gender,
      birth_year,
      competition_age,
      body_weight_kg,
      best_snatch,
      best_cj,
      total,
      snatch_successful_attempts,
      cj_successful_attempts,
      total_successful_attempts,
      bounce_back_snatch_2,
      bounce_back_snatch_3,
      bounce_back_cj_2,
      bounce_back_cj_3,
      gamx_u,
      gamx_a,
      gamx_masters,
      gamx_total,
      gamx_s,
      gamx_j,
      qpoints,
      q_masters,
      q_youth,
      best_snatch_ytd,
      best_cj_ytd,
      best_total_ytd,
      owlcms_lifters ( athlete_name )
    `)
    .limit(5);

  if (error) {
    console.error('❌ Verification query failed:', error.message);
    return;
  }

  console.log(`✅ Retrieved ${data.length} sample records.\n`);
  for (const row of data) {
    console.log('----------------------------------------------------');
    console.log(`Athlete: ${row.owlcms_lifters?.athlete_name} | Age: ${row.competition_age} (${row.gender}) | BW: ${row.body_weight_kg}kg | Total: ${row.total}kg`);
    console.log(`Makes: Snatch ${row.snatch_successful_attempts}/3, C&J ${row.cj_successful_attempts}/3 (Total: ${row.total_successful_attempts}/6)`);
    console.log(`Bounce-Backs: Snatch2: ${row.bounce_back_snatch_2}, Snatch3: ${row.bounce_back_snatch_3} | CJ2: ${row.bounce_back_cj_2}, CJ3: ${row.bounce_back_cj_3}`);
    console.log(`GAMX: U=${row.gamx_u}, A=${row.gamx_a}, Masters=${row.gamx_masters}, Total=${row.gamx_total}, S=${row.gamx_s}, J=${row.gamx_j}`);
    console.log(`Q-Scores: Q-Points=${row.qpoints}, Q-Masters=${row.q_masters}, Q-Youth=${row.q_youth}`);
    console.log(`YTD Bests: Snatch=${row.best_snatch_ytd}, C&J=${row.best_cj_ytd}, Total=${row.best_total_ytd}`);
  }
  console.log('----------------------------------------------------');
}

verify().catch(console.error);
