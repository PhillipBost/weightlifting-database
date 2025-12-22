const puppeteer = require('puppeteer');
const { scrapeAthleteDataWithFixedPagination } = require('./scripts/production/database-importer-fixed-pagination');

/**
 * Test the fixed pagination logic to ensure internal_id extraction works on all pages
 */

async function testFixedPagination() {
    console.log('🔍 Testing FIXED pagination logic for internal_id extraction...');
    
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });
    
    try {
        const page = await browser.newPage();
        
        // Test with the CA-South division that has multiple pages
        const testParams = {
            division: 'CA-South',
            ageCategory: 'Senior',
            weightClass: '109',
            gender: 'Male',
            startDate: new Date('2024-10-01'),
            endDate: new Date('2024-12-31')
        };
        
        console.log('📊 Testing with parameters:', testParams);
        
        // Run the fixed scraping function
        const athletes = await scrapeAthleteDataWithFixedPagination(
            page,
            testParams.division,
            testParams.ageCategory,
            testParams.weightClass,
            testParams.gender,
            testParams.startDate,
            testParams.endDate
        );
        
        console.log('\n📈 RESULTS SUMMARY:');
        console.log(`   Total athletes scraped: ${athletes.length}`);
        
        const athletesWithInternalIds = athletes.filter(a => a.internalId);
        console.log(`   Athletes with internal_ids: ${athletesWithInternalIds.length}`);
        
        if (athletesWithInternalIds.length > 0) {
            console.log('\n✅ SUCCESS: Athletes with internal_ids found:');
            athletesWithInternalIds.slice(0, 5).forEach((athlete, i) => {
                console.log(`   ${i+1}. ${athlete.athleteName}: internal_id ${athlete.internalId}`);
            });
            
            if (athletesWithInternalIds.length > 5) {
                console.log(`   ... and ${athletesWithInternalIds.length - 5} more`);
            }
        } else {
            console.log('❌ FAILURE: No athletes with internal_ids found');
        }
        
        // Check if we found Eli Smith specifically (if he's in this dataset)
        const eliSmith = athletes.find(a => a.athleteName.toLowerCase().includes('eli smith'));
        if (eliSmith) {
            console.log(`\n🎯 Found Eli Smith: ${eliSmith.athleteName}, internal_id: ${eliSmith.internalId || 'NOT FOUND'}`);
        }
        
        console.log('\n✅ Fixed pagination test completed!');
        return athletes;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Run the test
if (require.main === module) {
    testFixedPagination()
        .then((athletes) => {
            console.log(`\n🎉 Test completed successfully! Found ${athletes.length} athletes.`);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testFixedPagination };