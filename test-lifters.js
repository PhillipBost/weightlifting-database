const { findOrCreateIWFLifter } = require('./scripts/production/iwf-lifter-manager.js');

async function testUpsert() {
  console.log('Clearing table first (run SQL manually: DELETE FROM iwf_lifters;)');

  const athletes = [
    { name: 'WANG Hao', country: 'CHN', gender: 'M', birth_year: 1998 },
    { name: 'John Smith', country: 'USA', gender: 'M', birth_year: 1995 },
    { name: 'John Smith', country: 'GBR', gender: 'M', birth_year: 1995 },
    { name: 'JOHN DOE', country: 'USA', gender: 'M', birth_year: 1990 },
    { name: 'SMITH John', country: 'GBR', gender: 'M', birth_year: 1985 },
  ];

  for (const athlete of athletes) {
    try {
      const lifter = await findOrCreateIWFLifter(athlete.name, athlete.country, { gender: athlete.gender, birth_year: athlete.birth_year });
      console.log(`Upserted: ${lifter.athlete_name} (${lifter.country_code}) - ID: ${lifter.db_lifter_id} - New: ${lifter.isNew}`);
    } catch (error) {
      console.error(`Error upserting ${athlete.name}: ${error.message}`);
    }
  }
}

testUpsert().catch(console.error);
