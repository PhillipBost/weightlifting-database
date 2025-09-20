const { assignMeetWSO } = require('./meet-wso-assigner.js');

// Test California assignments
const testMeets = [
  { meet_id: 1, Meet: 'Test 1', address: 'San Francisco, California, United States of America' },
  { meet_id: 2, Meet: 'Test 2', address: '3000 Paseo Mercado #110, Oxnard, California, United States of America, 93036' },
  { meet_id: 3, Meet: 'Test 3', address: '800 N. State College Blvd, Fullerton, California, United States of America, 92831' },
  { meet_id: 4, Meet: 'Test 4', address: '6036 Variel Ave., Woodland Hills, California, United States of America, 91367' },
  { meet_id: 5, Meet: 'Test 5', address: '2010 3rd st, Sacramento, California, United States of America, 95818' }
];

console.log('Testing California WSO assignments:');
testMeets.forEach(meet => {
  const assignment = assignMeetWSO(meet, {});
  console.log(`${meet.address}`);
  console.log(`  -> ${assignment.assigned_wso || 'None'}`);
  console.log(`  Reasoning: ${assignment.details.reasoning.join('; ')}`);
  console.log('');
});