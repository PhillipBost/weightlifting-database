const testAddress = '5224 NE 42nd Ave, Portland, Oregon, United States of America, 97218';

console.log('Testing regex escaping:');

// Test single backslash (like in function)
const pattern1 = new RegExp(`\\bOregon\\b`, 'i');
console.log(`Single backslash: ${pattern1.test(testAddress)} (pattern: ${pattern1})`);

// Test double backslash (like in manual debug)  
const pattern2 = new RegExp(`\\\\bOregon\\\\b`, 'i');
console.log(`Double backslash: ${pattern2.test(testAddress)} (pattern: ${pattern2})`);

// Test template literal in function context
function testTemplate(fullName) {
    const namePattern = new RegExp(`\\b${fullName.replace(/\\s/g, '\\s+')}\\b`, 'i');
    return namePattern.test(testAddress);
}

console.log(`Template literal in function: ${testTemplate('Oregon')}`);

console.log(`Raw test: ${'Oregon'.replace(/\\s/g, '\\s+')}`);
console.log(`Regex source: ${new RegExp(`\\b${'Oregon'.replace(/\\s/g, '\\s+')}\\b`, 'i').source}`);