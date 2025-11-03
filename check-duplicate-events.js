const fs = require('fs');
const path = require('path');

// Years with phantom duplicate problems
const problemYears = [2000, 2003, 2004, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const outputDir = path.join('C:\\Users\\phill\\Desktop\\Bost Laboratory Services\\Weightlifting\\weightlifting-database\\output');

console.log('='.repeat(80));
console.log('CHECKING FOR DUPLICATE EVENT IDS IN JSON FILES');
console.log('='.repeat(80));

for (const year of problemYears) {
  const filePath = path.join(outputDir, `iwf_events_${year}.json`);

  if (!fs.existsSync(filePath)) {
    console.log(`\n⚠️  ${year}: File not found`);
    continue;
  }

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const events = content.events || [];

    // Check for duplicate event_ids
    const eventIds = new Map();
    const duplicates = [];

    for (const event of events) {
      if (eventIds.has(event.event_id)) {
        duplicates.push({
          event_id: event.event_id,
          event_name: event.event_name,
          date: event.date,
          count: (eventIds.get(event.event_id) || []).length + 1
        });
      } else {
        eventIds.set(event.event_id, [event]);
      }
    }

    if (duplicates.length > 0) {
      console.log(`\n🔴 ${year}: FOUND ${duplicates.length} DUPLICATE EVENT IDS!`);
      duplicates.forEach(dup => {
        console.log(`   Event ID ${dup.event_id}: "${dup.event_name}" (${dup.date}) - appears ${dup.count} times`);
      });
    } else {
      console.log(`\n✓ ${year}: OK - ${events.length} events, no duplicates`);
    }

  } catch (error) {
    console.log(`\n❌ ${year}: Error reading file - ${error.message}`);
  }
}

console.log('\n' + '='.repeat(80));
