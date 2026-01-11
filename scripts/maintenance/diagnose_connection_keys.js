require('dotenv').config();

const fullKeys = Object.keys(process.env);
const interestingKeys = fullKeys.filter(k =>
    k.includes('SUPABASE') ||
    k.includes('DB') ||
    k.includes('DATABASE') ||
    k.includes('POSTGRES') ||
    k.includes('URL') ||
    k.includes('KEY')
);

console.log('Available Config Keys:');
interestingKeys.forEach(k => console.log(`- ${k}`));

if (process.env.DATABASE_URL) {
    console.log('\n✅ DATABASE_URL is present.');
} else {
    console.log('\n❌ DATABASE_URL is missing.');
}
