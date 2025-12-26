/**
 * Test script to verify CSV parsing fixes in SmartImporter and DetailedOrchestrator
 */

const fs = require('fs').promises;
const path = require('path');

// Create a test CSV file with pipe-separated format
async function createTestCsvFile() {
    const testCsvContent = `Meet|Date|Age Category|Weight Class|Lifter|Body Weight (Kg)|Snatch Lift 1|Snatch Lift 2|Snatch Lift 3|Best Snatch|C&J Lift 1|C&J Lift 2|C&J Lift 3|Best C&J|Total|Club|Membership Number|Internal_ID
Test Meet|2024-01-15|Open Men's|105 kg|John Smith|102.5|120|125|130|130|150|155|160|160|290|Test Club||12345
Test Meet|2024-01-15|Open Women's|76 kg|Jane Doe|75.2|85|90|95|95|110|115|120|120|215|Another Club||67890`;

    const testFilePath = path.join(__dirname, 'temp', 'test_parsing.csv');
    
    // Ensure temp directory exists
    await fs.mkdir(path.dirname(testFilePath), { recursive: true });
    
    // Write test file
    await fs.writeFile(testFilePath, testCsvContent, 'utf8');
    
    return testFilePath;
}

// Test SmartImporter parsing
async function testSmartImporterParsing() {
    console.log('🧪 Testing SmartImporter._parseScrapedData...');
    
    try {
        const { SmartImporter } = require('./scripts/meet-re-import/lib/smart-importer');
        
        // Create mock logger and supabase client
        const mockLogger = {
            warn: (msg, errors) => console.log(`WARN: ${msg}`, errors),
            error: (msg) => console.log(`ERROR: ${msg}`)
        };
        
        const mockSupabase = {};
        
        const importer = new SmartImporter(mockSupabase, mockLogger);
        
        // Create test CSV file
        const testFile = await createTestCsvFile();
        
        // Test parsing
        const result = await importer._parseScrapedData(testFile);
        
        console.log(`✅ SmartImporter parsed ${result.length} records`);
        
        if (result.length > 0) {
            const firstRecord = result[0];
            console.log('📋 First record structure:');
            console.log(`   Name: ${firstRecord.name}`);
            console.log(`   Bodyweight: ${firstRecord.bodyweight}`);
            console.log(`   Best Snatch: ${firstRecord.bestSnatch}`);
            console.log(`   Total: ${firstRecord.total}`);
            console.log(`   Club: ${firstRecord.club}`);
            
            // Verify column name parsing worked
            if (firstRecord.name === 'John Smith' && 
                String(firstRecord.bodyweight) === '102.5' && 
                String(firstRecord.bestSnatch) === '130' &&
                String(firstRecord.total) === '290') {
                console.log('✅ SmartImporter column name parsing works correctly!');
            } else {
                console.log('❌ SmartImporter column name parsing failed');
                console.log('Expected: John Smith, 102.5, 130, 290');
                console.log(`Got: ${firstRecord.name}, ${firstRecord.bodyweight}, ${firstRecord.bestSnatch}, ${firstRecord.total}`);
            }
        }
        
        // Clean up
        await fs.unlink(testFile);
        
    } catch (error) {
        console.error('❌ SmartImporter test failed:', error.message);
    }
}

// Test DetailedOrchestrator parsing
async function testDetailedOrchestratorParsing() {
    console.log('\n🧪 Testing DetailedOrchestrator._analyzeScrapedData...');
    
    try {
        const { DetailedReImportOrchestrator } = require('./scripts/meet-re-import/lib/detailed-orchestrator');
        
        // Create mock supabase client
        const mockSupabase = {};
        
        const orchestrator = new DetailedReImportOrchestrator(mockSupabase, { tempDir: './temp' });
        
        // Create test CSV file
        const testFile = await createTestCsvFile();
        
        // Test parsing
        const result = await orchestrator._analyzeScrapedData(testFile);
        
        console.log(`✅ DetailedOrchestrator analyzed ${result.athleteCount} athletes`);
        
        if (result.athletes.length > 0) {
            const firstAthlete = result.athletes[0];
            console.log('📋 First athlete structure:');
            console.log(`   Name: ${firstAthlete.name}`);
            console.log(`   Club: ${firstAthlete.club}`);
            console.log(`   Bodyweight: ${firstAthlete.bodyweight}`);
            console.log(`   Total: ${firstAthlete.total}`);
            
            // Verify column name parsing worked
            if (firstAthlete.name === 'John Smith' && 
                String(firstAthlete.bodyweight) === '102.5' && 
                String(firstAthlete.total) === '290') {
                console.log('✅ DetailedOrchestrator column name parsing works correctly!');
            } else {
                console.log('❌ DetailedOrchestrator column name parsing failed');
                console.log('Expected: John Smith, 102.5, 290');
                console.log(`Got: ${firstAthlete.name}, ${firstAthlete.bodyweight}, ${firstAthlete.total}`);
            }
        }
        
        // Clean up
        await fs.unlink(testFile);
        
    } catch (error) {
        console.error('❌ DetailedOrchestrator test failed:', error.message);
    }
}

// Run tests
async function runTests() {
    console.log('🚀 Testing CSV parsing fixes...\n');
    
    await testSmartImporterParsing();
    await testDetailedOrchestratorParsing();
    
    console.log('\n✅ CSV parsing fix tests completed!');
}

// Run if called directly
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { runTests };