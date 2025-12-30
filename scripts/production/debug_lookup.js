const path = require('path');
const fs = require('fs');

// Mock data
const divisionCodesPath = path.join(__dirname, '../../division_base64_codes.json');
const divisionCodes = JSON.parse(fs.readFileSync(divisionCodesPath, 'utf8')).division_codes;

const ageCategory = "Open Men's";
const weightClass = "56kg"; // Derived from 37.2 bodyweight -> 56kg (Standard) OR "56 kg" from CSV?
// Let's test both
const weightClass1 = "56kg";
const weightClass2 = "56 kg";

const eventDate = "2016-12-10";
const meetDate = new Date(eventDate);
const activeDivisionCutoff = new Date('2025-06-01');
const isActiveDivision = meetDate >= activeDivisionCutoff;

console.log(`Debug: active=${isActiveDivision}`);

function check(cat, wc) {
    console.log(`\nChecking: "${cat}" + "${wc}"`);
    const divisionName = `${cat} ${wc}`;

    // Logic from my fix
    let divisionNameAlt = '';
    if (wc.includes(' kg')) {
        divisionNameAlt = `${cat} ${wc.replace(' kg', 'kg')}`;
    } else {
        divisionNameAlt = `${cat} ${wc.replace('kg', ' kg')}`;
    }

    console.log(`  Name: "${divisionName}"`);
    console.log(`  Alt:  "${divisionNameAlt}"`);

    const checkCode = (name) => {
        const direct = divisionCodes[name];
        const inactive = divisionCodes[`(Inactive) ${name}`];
        console.log(`    Lookup "${name}": ${direct}`);
        console.log(`    Lookup "(Inactive) ${name}": ${inactive}`);

        if (isActiveDivision) {
            return direct || inactive;
        } else {
            return inactive || direct;
        }
    };

    let code = checkCode(divisionName);
    if (!code && divisionNameAlt) {
        console.log("  Initial check failed, trying alt...");
        code = checkCode(divisionNameAlt);
    }

    if (code) console.log(`  ✅ CODE FOUND: ${code}`);
    else console.log(`  ❌ NO CODE FOUND`);
}

check(ageCategory, weightClass1);
check(ageCategory, weightClass2);
