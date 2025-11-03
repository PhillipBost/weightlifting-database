const fs = require('fs');
const csv = require('csv-parse/sync');

const filePath = 'C:\\Users\\phill\\Downloads\\Supabase Snippet Duplicate Performance Records Across Meets (1).csv';
const content = fs.readFileSync(filePath, 'utf-8');
const records = csv.parse(content, { columns: true });

console.log(`Total rows: ${records.length}`);
console.log(`Total groups: ${new Set(records.map(r => r.group_id)).size}`);

// Analyze meet_id pairs
const groupedByGroup = {};
records.forEach(r => {
  if (!groupedByGroup[r.group_id]) {
    groupedByGroup[r.group_id] = [];
  }
  groupedByGroup[r.group_id].push(r);
});

const meetPairs = {};
Object.entries(groupedByGroup).forEach(([gid, rows]) => {
  const pair = rows.map(r => r.db_meet_id).sort().join('|');
  meetPairs[pair] = (meetPairs[pair] || 0) + 1;
});

console.log('\n========================================');
console.log('MOST COMMON MEET_ID PAIRS');
console.log('========================================');
Object.entries(meetPairs)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([pair, count]) => {
    const [id1, id2] = pair.split('|');
    const rows = records.filter(r => r.db_meet_id === id1 || r.db_meet_id === id2);
    const meet1 = rows.find(r => r.db_meet_id === id1);
    const meet2 = rows.find(r => r.db_meet_id === id2);
    console.log(`\nPair: ${id1} <-> ${id2}`);
    console.log(`  Groups: ${count}`);
    console.log(`  ${id1}: ${meet1.meet_name} (${meet1.date})`);
    console.log(`  ${id2}: ${meet2.meet_name} (${meet2.date})`);
  });

// Meets involved
console.log('\n\n========================================');
console.log('ALL MEETS INVOLVED');
console.log('========================================');
const meets = {};
records.forEach(r => {
  if (!meets[r.db_meet_id]) {
    meets[r.db_meet_id] = { name: r.meet_name, date: r.date, count: 0 };
  }
  meets[r.db_meet_id].count++;
});
Object.entries(meets)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([id, info]) => {
    console.log(`${id}: ${info.name} (${info.date}) - ${info.count} records`);
  });

// Duplicate count distribution
console.log('\n\n========================================');
console.log('DUPLICATE COUNT DISTRIBUTION');
console.log('========================================');
const dupDist = {};
records.forEach(r => {
  dupDist[r.duplicate_count] = (dupDist[r.duplicate_count] || 0) + 1;
});
Object.entries(dupDist)
  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([count, total]) => {
    const groups = total / parseInt(count);
    console.log(`${count} copies: ${groups} groups = ${total} records`);
  });
