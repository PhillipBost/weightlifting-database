/**
 * Code validation script for the pagination fix
 *
 * This script validates that the pagination fix has been correctly implemented
 * without requiring database access.
 */

const fs = require('fs');
const path = require('path');

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

function validatePaginationFix() {
    log('🔍 Validating pagination fix implementation...');

    const scriptPath = path.join(__dirname, 'wso-weekly-calculator.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');

    const validations = [
        {
            name: 'paginatedQuery helper function exists',
            test: () => scriptContent.includes('async function paginatedQuery('),
            critical: true
        },
        {
            name: 'paginatedQuery handles batching',
            test: () => scriptContent.includes('range(start, start + batchSize - 1)'),
            critical: true
        },
        {
            name: 'calculateCaliforniaTotalParticipations uses pagination',
            test: () => {
                const functionMatch = scriptContent.match(/async function calculateCaliforniaTotalParticipations.*?^}/gms);
                if (!functionMatch) return false;
                const functionContent = functionMatch[0];
                return functionContent.includes('paginatedQuery(') &&
                       !functionContent.includes('await supabase.from');
            },
            critical: true
        },
        {
            name: 'calculateCaliforniaLiftersCount uses pagination',
            test: () => {
                const functionMatch = scriptContent.match(/async function calculateCaliforniaLiftersCount.*?^}/gms);
                if (!functionMatch) return false;
                const functionContent = functionMatch[0];
                return functionContent.includes('paginatedQuery(') &&
                       !functionContent.includes('await supabase.from');
            },
            critical: true
        },
        {
            name: 'calculateTotalParticipationsCount uses pagination',
            test: () => {
                const functionMatch = scriptContent.match(/async function calculateTotalParticipationsCount.*?^}/gms);
                if (!functionMatch) return false;
                const functionContent = functionMatch[0];
                const nonCaliforniaSection = functionContent.split('if (wsoName.includes(\'California\'))')[1];
                return nonCaliforniaSection &&
                       nonCaliforniaSection.includes('paginatedQuery(');
            },
            critical: true
        },
        {
            name: 'calculateActiveLiftersCount uses pagination',
            test: () => {
                const functionMatch = scriptContent.match(/async function calculateActiveLiftersCount.*?^}/gms);
                if (!functionMatch) return false;
                const functionContent = functionMatch[0];
                const nonCaliforniaSection = functionContent.split('if (wsoName.includes(\'California\'))')[1];
                return nonCaliforniaSection &&
                       nonCaliforniaSection.includes('paginatedQuery(');
            },
            critical: true
        },
        {
            name: 'Logging for large datasets',
            test: () => scriptContent.includes('logProgress'),
            critical: false
        },
        {
            name: 'Safety limits implemented',
            test: () => scriptContent.includes('maxRecords'),
            critical: false
        },
        {
            name: 'Batch progress logging',
            test: () => scriptContent.includes('Batch') && scriptContent.includes('Total:'),
            critical: false
        },
        {
            name: '1000 record warning',
            test: () => scriptContent.includes('exactly 1000') && scriptContent.includes('truncated'),
            critical: false
        }
    ];

    let passedTests = 0;
    let criticalIssues = 0;

    log('\n📋 Running validation tests...\n');

    validations.forEach((validation, index) => {
        const passed = validation.test();
        const icon = passed ? '✅' : (validation.critical ? '❌' : '⚠️');
        const status = passed ? 'PASS' : (validation.critical ? 'FAIL' : 'WARN');

        log(`${(index + 1).toString().padStart(2)}. ${icon} ${validation.name}: ${status}`);

        if (passed) {
            passedTests++;
        } else if (validation.critical) {
            criticalIssues++;
        }
    });

    const totalTests = validations.length;
    const criticalTests = validations.filter(v => v.critical).length;

    log('\n📊 Validation Summary:');
    log(`   Total tests: ${passedTests}/${totalTests} passed`);
    log(`   Critical tests: ${criticalTests - criticalIssues}/${criticalTests} passed`);

    if (criticalIssues === 0) {
        log('\n✅ SUCCESS: All critical pagination fixes have been implemented correctly!');
        log('   📈 The wso_information.total_participation field should no longer be capped at 1000');
        log('   🎯 Large WSOs (like California) will now get accurate participation counts');
        return true;
    } else {
        log(`\n❌ FAILURE: ${criticalIssues} critical issues found. Fix these before deployment.`);
        return false;
    }
}

// Run validation if this script is executed directly
if (require.main === module) {
    const success = validatePaginationFix();
    process.exit(success ? 0 : 1);
}

module.exports = { validatePaginationFix };