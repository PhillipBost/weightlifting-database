//may need some refactoring to move thru quickly
const puppeteer = require('puppeteer')
const { createCSVfromArray, writeCSV } = require('../../utils/csv_utils');
const {handleTotalAthleteString, getAmountMeetsOnPage} = require('../../utils/string_utils')
const {getAthletesOnPage} = require('../../utils/scraping_utils')

async function scrapeOneMeet(meetNumber, filePath){
    let baseUrl = 'https://usaweightlifting.sport80.com/public/rankings/results/'
    let url = baseUrl + meetNumber;
    
    
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--disable-extensions'
        ]
    });
    const page = await browser.newPage();
    await page.setViewport({width:1500, height:1000})
    await page.goto(url, {
        waitUntil: 'networkidle0'
    })
    
    
    async function getPageData(){    
        return await page.$eval(
             ".data-table div div.v-data-table div.v-data-footer div.v-data-footer__pagination",
             x =>  x.textContent
        )
    }
    
        
    const tableHeaderData = await page.evaluate(()=>{
        let elArr = Array.from(document.querySelectorAll(".data-table div div.v-data-table div.v-data-table__wrapper table thead tr th > span"))
        elArr = elArr.map((x)=>{
            return  x.textContent
        })
        return elArr
    })

	if(tableHeaderData.length > 0){
		// Modify headers to match our split age category/weight class
		if (tableHeaderData.length >= 3) {
			// Replace the combined "Age Category" header with separate headers
			tableHeaderData.splice(2, 1, 'Age Category', 'Weight Class');
		}
    
		let headerCSV = tableHeaderData.join('|');
		headerCSV += '\n'
		writeCSV(filePath, headerCSV);
    }else{
        await browser.close()
        throw new Error('no meet available')
    }


    ///hunting in here
    await getAthletesOnPage(getAmountMeetsOnPage(await getPageData()), page, filePath);
    // console.log(await getPageData())

    console.log('Initial page data:', await getPageData());
	while(await handleTotalAthleteString(await getPageData())){
        // console.log('getting resourses...')
        await Promise.all([
            page.waitForNetworkIdle(),
            page.click('.data-table div div.v-data-table div.v-data-footer div.v-data-footer__icons-after'),
        ]);
        // console.log(await getPageData())
        await getAthletesOnPage(getAmountMeetsOnPage(await getPageData()), page, filePath)
    }
	console.log('Final page data:', await getPageData());

    // console.log('getting resourses...')
    // console.log(await getPageData())
    // console.log('done scraping')

    await browser.close();
}


// scrapeOneMeet(444,'./meet_1.csv')
module.exports = {
    scrapeOneMeet:scrapeOneMeet
}