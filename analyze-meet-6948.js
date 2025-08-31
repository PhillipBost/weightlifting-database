require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function analyzeMeet6948() {
  console.log('🔍 Analyzing meet 6948...\n');
  
  // Get meet info
  const { data: meetInfo, error: meetError } = await supabase
    .from('meets')
    .select('*')
    .eq('meet_id', 6948)
    .single();
  
  if (meetError) {
    console.log('❌ Error getting meet info:', meetError.message);
    return;
  }
  
  console.log('📊 MEET INFORMATION:');
  console.log('   Meet ID:', meetInfo.meet_id);
  console.log('   Meet Name:', meetInfo.Meet);
  console.log('   Date:', meetInfo.Date);
  console.log('   Level:', meetInfo.Level);
  console.log('   Results Count (meets table):', meetInfo.Results);
  console.log('   URL:', meetInfo.URL);
  console.log('   Internal ID:', meetInfo.meet_internal_id);
  console.log('');
  
  // Count actual results
  const { count: actualCount, error: countError } = await supabase
    .from('meet_results')
    .select('result_id', { count: 'exact', head: true })
    .eq('meet_id', 6948);
  
  if (countError) {
    console.log('❌ Error counting results:', countError.message);
    return;
  }
  
  console.log('📊 RESULTS ANALYSIS:');
  console.log('   Expected results (meets table):', meetInfo.Results || 'Unknown');
  console.log('   Actual results (meet_results table):', actualCount);
  console.log('   Difference:', (meetInfo.Results || 0) - actualCount);
  console.log('');
  
  // Sample some results
  const { data: sampleResults, error: sampleError } = await supabase
    .from('meet_results')
    .select('result_id, lifter_id, lifter_name, date, age_category, weight_class, total, wso')
    .eq('meet_id', 6948)
    .order('result_id', { ascending: true })
    .limit(10);
  
  if (sampleError) {
    console.log('❌ Error getting sample results:', sampleError.message);
    return;
  }
  
  console.log('📋 SAMPLE RESULTS (first 10):');
  sampleResults.forEach((result, i) => {
    console.log(`   ${i+1}. ${result.lifter_name} (result_id: ${result.result_id}, lifter_id: ${result.lifter_id})`);
    console.log(`      Date: ${result.date}, Division: ${result.age_category} ${result.weight_class}, Total: ${result.total}, WSO: ${result.wso || 'Missing'}`);
  });
  console.log('');
  
  // Check for missing WSO data
  const { count: missingWsoCount, error: wsoError } = await supabase
    .from('meet_results')
    .select('result_id', { count: 'exact', head: true })
    .eq('meet_id', 6948)
    .is('wso', null);
  
  if (wsoError) {
    console.log('❌ Error counting missing WSO:', wsoError.message);
    return;
  }
  
  console.log('📊 DATA QUALITY:');
  console.log(`   Results missing WSO: ${missingWsoCount}/${actualCount} (${actualCount > 0 ? ((missingWsoCount/actualCount)*100).toFixed(1) : 0}%)`);
  
  // Check for unique lifters
  const { data: uniqueLifters, error: liftersError } = await supabase
    .from('meet_results')
    .select('lifter_id')
    .eq('meet_id', 6948);
  
  if (!liftersError) {
    const uniqueLifterIds = new Set(uniqueLifters.map(r => r.lifter_id));
    console.log(`   Unique lifters: ${uniqueLifterIds.size}`);
    console.log(`   Average results per lifter: ${(actualCount/uniqueLifterIds.size).toFixed(1)}`);
  }
  
  // Check date issues
  console.log('\n📅 DATE ANALYSIS:');
  const { data: dateAnalysis, error: dateError } = await supabase
    .from('meet_results')
    .select('date')
    .eq('meet_id', 6948)
    .limit(20);
  
  if (!dateError && dateAnalysis) {
    const uniqueDates = [...new Set(dateAnalysis.map(r => r.date))];
    console.log(`   Unique dates in results: ${uniqueDates.length}`);
    console.log(`   Sample dates: ${uniqueDates.slice(0, 10).join(', ')}`);
    
    // Check if any dates look like birthdays (very old dates)
    const suspiciousDates = uniqueDates.filter(date => {
      if (!date) return false;
      const year = new Date(date).getFullYear();
      return year < 2000; // Dates before 2000 might be birthdays
    });
    
    if (suspiciousDates.length > 0) {
      console.log(`   ⚠️ Potentially suspicious dates (before 2000): ${suspiciousDates.join(', ')}`);
    }
  }
}

analyzeMeet6948().catch(console.error);