const { parseAgeAndWeightCategory } = require('./data_utils');
const { createCSVfromArray, writeCSV } = require("./csv_utils");


//gets all athletes on the page
async function getAthletesOnPage(athletesOnPage, page , filePath){
    let allAthleteData =[];
    let skippedCount = 0;
    
    // Try to get one extra row to make sure we don't miss the last one
    for(let i = 1; i <= athletesOnPage + 1; i++){
        let athleteData = await page.evaluate((index)=>{
            let selector = ".data-table div div.v-data-table div.v-data-table__wrapper table tbody tr:nth-of-type("+ index +") td > div"
            let elArr = Array.from(document.querySelectorAll(`${selector}`))
            elArr = elArr.map((x)=>{
                let el = x.textContent.replace('|', ',')
                return  el.trim()
            })
            return elArr
        },i)
        
        // Skip if no data found (beyond last row)
        if (athleteData.length === 0) {
            continue;
        }
        
        // Skip header rows
        const isHeaderRow = athleteData[6] === 'Snatch Lift 1';
        
        if (!isHeaderRow) {
			// Parse age category and weight class if we have enough data
			if (athleteData.length >= 3) {
				const parsed = parseAgeAndWeightCategory(athleteData[2]);
				// Replace the combined category with separate fields
				athleteData.splice(2, 1, parsed.ageCategory, parsed.weightClass);
			}
			
            allAthleteData.push(athleteData)
        } else {
            console.log('Skipping header row:', athleteData.slice(0,3));
            skippedCount++;
        }
    }
    
    console.log(`Processed up to ${athletesOnPage + 1} rows, kept ${allAthleteData.length}, skipped ${skippedCount}`);
    
    let weightliftingCSV = createCSVfromArray(allAthleteData);
    console.log('DEBUG: First few lines of CSV:', weightliftingCSV.substring(0, 200)); // Add this line
	writeCSV(filePath, weightliftingCSV)
  
}

//clicks button for metadata to access the meet urls
//helps with later scraping
async function getMeetUrl(index, page){
    //click on a random element first
    await page.click('h2.flex-shrink-0.align-self-end.subtitle-1', {waitUntil:'visible'})
    
    //click the elipses button on the specific element
    await page.click(`tbody tr:nth-of-type(${index}) td.text-end button.v-btn.v-btn--icon`)        
    
    //wait for the view button to pop up
    let viewBtnSelector = 'div.v-menu__content.menuable__content__active div.v-list.v-sheet div a div.v-list-item__content div.v-list-item__title';
    await page.waitForSelector(viewBtnSelector, {waitUntil:'visible'})
    
    //get the href value of the view button
    let viewBtn = 'div.v-menu__content.menuable__content__active div.v-list.v-sheet div a';
    const meetHref = await page.$eval(viewBtn, anchor => anchor.getAttribute('href'));
    const meetHrefNum = meetHref.split('/')[4]
    return meetHrefNum;
}

//gets you 1-30 of total entries
//this gets used to track progress of meet/athlete scrapers
async function getPageData(page){
    return await page.$eval(
        ".data-table div div.v-data-table div.v-data-footer div.v-data-footer__pagination",
        x =>  x.textContent
    )
}

async function getTableHeaderData (page){
    return await page.evaluate(()=>{
        // Debug: let's see what's actually on the page
        console.log("DEBUG: Looking for table headers");
        
        // Try the original selector
        let elArr = Array.from(document.querySelectorAll(".data-table div div.v-data-table div.v-data-table__wrapper table thead tr th > span"));
        console.log("DEBUG: Original selector found", elArr.length, "elements");
        
        // If that fails, try simpler selectors
        if (elArr.length === 0) {
            elArr = Array.from(document.querySelectorAll("table thead tr th"));
            console.log("DEBUG: Simple th selector found", elArr.length, "elements");
        }
        
        if (elArr.length === 0) {
            elArr = Array.from(document.querySelectorAll("th"));
            console.log("DEBUG: Just th selector found", elArr.length, "elements");
        }
        
        elArr = elArr.map((x)=>{
            return x.textContent
        })
        console.log("DEBUG: Header text:", elArr);
        return elArr
    })
}

//used for meet metadata
async function getTableWriteCsv(filePath, page){
    let tableHeaderData = await getTableHeaderData(page)
    tableHeaderData[4]= 'Meet Url'
    console.log(tableHeaderData)
    let headerCSV = tableHeaderData.join(',');
    headerCSV += '\n'
    writeCSV(filePath, headerCSV);
}


async function getMeetsOnPage(athletesOnPage, page , filePath){
    let allAthleteData =[];
    for(let i = 1; i <= athletesOnPage+1; i++){
        //can remove to have the scraper move quicker
        let meetUrl = await getMeetUrl(i, page);
        let athleteData = await page.evaluate((index)=>{
            let selector = ".data-table div div.v-data-table div.v-data-table__wrapper table tbody tr:nth-of-type("+ index +") td > div"
            let elArr = Array.from(document.querySelectorAll(`${selector}`))
            elArr = elArr.map((x)=>{
                let el = x.textContent.replace('|', ',')
				return  el.trim()

				// Properly escape for CSV: wrap in quotes if contains comma, quote, or newline
				if (el.includes(',') || el.includes('"') || el.includes('\n')) {
					el = '"' + el.replace(/"/g, '""') + '"';
				}
				return el
            })
            return elArr
        },i)
        //needs to change too
        athleteData[athleteData.length-1] = meetUrl
        //removes last element the non used action empty guy?
        //athleteData.pop()
        // console.log(athleteData)
        allAthleteData.push(athleteData)
    }

    let weightliftingCSV = createCSVfromArray(allAthleteData);
    writeCSV(filePath, weightliftingCSV)    
}

async function clickFilter(page){
    console.log('clicking filter button')
    await page.click('.data-table div.container.pb-0 div.s80-filter div.row.no-gutters .v-badge button.v-btn');      
}

async function clickApply(page){
    console.log('clicking apply')
    await page.waitForSelector("div.v-card__actions.justify-end button.primary.my-2.v-btn.v-btn--is-elevated")
    await page.click("div.v-card__actions.justify-end button.primary.my-2.v-btn.v-btn--is-elevated", {
        waitUntil: 'networkidle0'
    })     
}
async function clickDate(page){
    console.log('getting the date')
    await page.waitForSelector('div.v-date-picker-table table tbody tr td:nth-of-type(1) button.v-btn div.v-btn__content')
    await page.click("div.v-date-picker-table table tbody tr td:nth-of-type(1) button.v-btn div.v-btn__content")  
}
async function moveBackMonth(page){
    await page.click("div.v-date-picker-header button.v-btn.v-btn--icon.v-btn--round.theme--light.v-size--default")
}


module.exports = {
    getAthletesOnPage,
    getMeetUrl,
    getPageData,
    getTableHeaderData,
    getMeetsOnPage,
    moveBackMonth,
    clickApply,
    clickDate,
    clickFilter,
    getTableWriteCsv,

}