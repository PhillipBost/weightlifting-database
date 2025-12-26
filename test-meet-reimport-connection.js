#!/usr/bin/env node

/**
 * Test Meet Re-Import System Connection to Fixed Database Importer
 * 
 * Verifies that the meet re-import system is properly connected to the
 * database-importer-custom-extreme-fix.js with same-name athletes handling.
 */

require('dotenv').config();

async function testConnection() {
    console.log('🔗 Testing Meet Re-Import System Connection');
    console.log('==========================================');
    
    try {
        // Test 1: Verify SmartImporter imports the correct module
        console.log('\n📋 Test 1: SmartImporter Module Connection');
        console.log('------------------------------------------');
        
        const { SmartImporter } = require('./scripts/meet-re-import/lib/smart-importer.js');
        console.log('✅ SmartImporter loaded successfully');
        
        // Check if the SmartImporter code references the correct file
        const fs = require('fs');
        const smartImporterCode = fs.readFileSync('./scripts/meet-re-import/lib/smart-importer.js', 'utf8');
        
        if (smartImporterCode.includes('database-importer-custom-extreme-fix')) {
            console.log('✅ SmartImporter correctly imports database-importer-custom-extreme-fix.js');
        } else {
            console.log('❌ SmartImporter still imports old database-importer-custom.js');
            return false;
        }
        
        // Test 2: Verify DetailedOrchestrator imports the correct module
        console.log('\n📋 Test 2: DetailedOrchestrator Module Connection');
        console.log('------------------------------------------------');
        
        const { DetailedReImportOrchestrator } = require('./scripts/meet-re-import/lib/detailed-orchestrator.js');
        console.log('✅ DetailedReImportOrchestrator loaded successfully');
        
        const orchestratorCode = fs.readFileSync('./scripts/meet-re-import/lib/detailed-orchestrator.js', 'utf8');
        
        if (orchestratorCode.includes('database-importer-custom-extreme-fix')) {
            console.log('✅ DetailedOrchestrator correctly imports database-importer-custom-extreme-fix.js');
        } else {
            console.log('❌ DetailedOrchestrator still imports old database-importer-custom.js');
            return false;
        }
        
        // Test 3: Verify the fixed importer has the same-name logic
        console.log('\n📋 Test 3: Same-Name Athletes Fix Verification');
        console.log('----------------------------------------------');
        
        const fixedImporterCode = fs.readFileSync('./scripts/production/database-importer-custom-extreme-fix.js', 'utf8');
        
        const hasScenarioLogic = fixedImporterCode.includes('hasSameDivisionResults') &&
                               fixedImporterCode.includes('same meet, SAME division detected') &&
                               fixedImporterCode.includes('skipping Tier 1');
        
        if (hasScenarioLogic) {
            console.log('✅ Fixed importer contains same-name athletes disambiguation logic');
        } else {
            console.log('❌ Fixed importer missing same-name athletes logic');
            return false;
        }
        
        // Test 4: Verify processMeetCsvFile function exists in fixed importer
        console.log('\n📋 Test 4: Function Availability Check');
        console.log('-------------------------------------');
        
        try {
            const { processMeetCsvFile } = require('./scripts/production/database-importer-custom-extreme-fix.js');
            
            if (typeof processMeetCsvFile === 'function') {
                console.log('✅ processMeetCsvFile function available in fixed importer');
            } else {
                console.log('❌ processMeetCsvFile function not found in fixed importer');
                return false;
            }
        } catch (error) {
            console.log(`❌ Error loading processMeetCsvFile: ${error.message}`);
            return false;
        }
        
        // Test 5: Verify CLI script loads correctly
        console.log('\n📋 Test 5: CLI Script Integration');
        console.log('---------------------------------');
        
        try {
            const { MeetReImportCLI } = require('./scripts/meet-re-import/re-import-meets.js');
            console.log('✅ Meet re-import CLI loads successfully');
            
            if (typeof MeetReImportCLI === 'function') {
                console.log('✅ MeetReImportCLI class available');
            } else {
                console.log('❌ MeetReImportCLI class not found');
                return false;
            }
        } catch (error) {
            console.log(`❌ Error loading CLI: ${error.message}`);
            return false;
        }
        
        console.log('\n🎉 CONNECTION TEST SUMMARY');
        console.log('===========================');
        console.log('✅ Meet re-import system is properly connected to fixed database importer');
        console.log('✅ Same-name athletes disambiguation logic is integrated');
        console.log('✅ All required functions and classes are available');
        console.log('✅ CLI script is ready for use');
        
        console.log('\n🚀 READY TO USE:');
        console.log('================');
        console.log('# Test a specific meet (dry run)');
        console.log('node scripts/meet-re-import/re-import-meets.js --dry-run --meet-ids=2308');
        console.log('');
        console.log('# Import missing results for a specific meet');
        console.log('node scripts/meet-re-import/re-import-meets.js --meet-ids=2308');
        console.log('');
        console.log('# Import with detailed logging');
        console.log('node scripts/meet-re-import/re-import-meets.js --meet-ids=2308 --log-level=debug');
        
        return true;
        
    } catch (error) {
        console.error('💥 Connection test failed:', error.message);
        return false;
    }
}

// Run test
if (require.main === module) {
    testConnection().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('💥 Test error:', error.message);
        process.exit(1);
    });
}

module.exports = { testConnection };