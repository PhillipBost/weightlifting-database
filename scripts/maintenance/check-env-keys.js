require('dotenv').config();

console.log('Available Environment Variables (Keys Only):');
Object.keys(process.env).forEach(key => {
    if (key.includes('SUPABASE')) {
        console.log(key);
    }
});
