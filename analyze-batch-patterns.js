const fs = require('fs');
const csv = require('csv-parse/sync');

const filePath = 'C:\\Users\\phill\\Downloads\\Supabase Snippet Duplicate Performance Records Across Meets (1).csv';
const content = fs.readFileSync(filePath, 'utf-8');
const records = csv.parse(content, { columns: true });

// Group by top problem pairs
const problemPairs = [
  '671|672',
  '785|788',
  '1089|1090',
  '1019|1020',
  '864|865',
  '652|653'
];

console.log('========================================');
console.log('CREATED_AT TIMESTAMP ANALYSIS');
console.log('========================================');

problemPairs.forEach(pair => {
  const [id1, id2] = pair.split('|');
  const records1 = records.filter(r => r.db_meet_id === id1);
  const records2 = records.filter(r => r.db_meet_id === id2);

  console.log(`\n\nMeet Pair: ${id1} <-> ${id2}`);
  console.log(`Meet 1: ${records1[0]?.meet_name} (${records1[0]?.date})`);
  console.log(`Meet 2: ${records2[0]?.meet_name} (${records2[0]?.date})`);

  const times1 = records1.map(r => new Date(r.created_at).getTime()).sort((a, b) => a - b);
  const times2 = records2.map(r => new Date(r.created_at).getTime()).sort((a, b) => a - b);

  console.log(`\nMeet ${id1} created_at range:`);
  console.log(`  Earliest: ${new Date(times1[0]).toISOString()}`);
  console.log(`  Latest:   ${new Date(times1[times1.length-1]).toISOString()}`);
  console.log(`  Span:     ${(times1[times1.length-1] - times1[0]) / 1000 / 60} minutes`);

  console.log(`\nMeet ${id2} created_at range:`);
  console.log(`  Earliest: ${new Date(times2[0]).toISOString()}`);
  console.log(`  Latest:   ${new Date(times2[times2.length-1]).toISOString()}`);
  console.log(`  Span:     ${(times2[times2.length-1] - times2[0]) / 1000 / 60} minutes`);

  // Check if created_at times are in same session
  const allTimes = [...times1, ...times2].sort((a, b) => a - b);
  const timeRange = allTimes[allTimes.length - 1] - allTimes[0];

  console.log(`\nCombined time range: ${timeRange / 1000 / 60} minutes`);

  // Check if created_at times overlap significantly
  const overlap = times1.filter(t => {
    return times2.some(t2 => Math.abs(t - t2) < 10000); // within 10 seconds
  });

  if (overlap.length > 0) {
    console.log(`\n⚠️  SAME BATCH: ${overlap.length} records created within 10 seconds of each other`);
    console.log(`   Indicates both meets were imported in the SAME scraper run`);
  } else {
    console.log(`\n✓ Different batches`);
  }
});

// Overall pattern
console.log('\n\n========================================');
console.log('OVERALL IMPORT PATTERN');
console.log('========================================');

const allCreatedDates = records
  .map(r => new Date(r.created_at).toISOString().split('T')[0])
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort();

console.log(`\nDuplicate records created across ${allCreatedDates.length} different days:`);
allCreatedDates.slice(0, 10).forEach(date => {
  const count = records.filter(r => r.created_at.startsWith(date)).length;
  console.log(`  ${date}: ${count} records`);
});

// Most common created_at times (indicates batch imports)
const timeGroups = {};
records.forEach(r => {
  const t = r.created_at.substring(0, 19); // YYYY-MM-DD HH:MM:SS
  timeGroups[t] = (timeGroups[t] || 0) + 1;
});

const sortedTimes = Object.entries(timeGroups)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log(`\nTop 10 import timestamps:`);
sortedTimes.forEach(([time, count]) => {
  console.log(`  ${time}: ${count} records`);
});
