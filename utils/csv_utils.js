const fsPromise = require('fs/promises')
const fs = require('fs');
const csv = require('csv-parser');
const fastcsv = require('fast-csv')
const util = require('util');
const readdir = util.promisify(fs.readdir);
const unlink = util.promisify(fs.unlink);

//utility function for writing csvs
function mapToString(map){
  let str = 'Meet|Level|Date|Results|Meet Url\n';
  map.forEach((value,key,map)=>{
      let meetStr = `${value.Meet}|${value.Level}|${value.Date}|${value.Results}|${value["Meet Url"]}`    
      return str += meetStr +"\n"
  })
  return str;
}

//this is going to need to change i believe
async function extractMeetUrls(csvFilePath) {
    return new Promise((resolve, reject) => {
        const meetUrls = [];
      
        fs.createReadStream(csvFilePath)
          .pipe(csv({ separator: '|' }))
          // .pipe(csv({ separator: '|' }))
          .on('data', (row) => {
            //needs to remove leading whitespace becasue future scrapers wont have whitespace between pipes
            // meetUrls.push(row[' Meet Url'].trim());
            
            meetUrls.push(row['Meet Url'].trim());
          })
          .on('end', () => {
            // console.log('Meet URLs extracted:', meetUrls);
            resolve(meetUrls)
          })
          .on('error',(err)=>{
            console.log(err)
            reject(err)
          })
    });

}

function createCSVfromArray(arr){
    let newCSV = arr.map( (el)=> {
        return el.join('|')
    }).join('\n')
    newCSV += '\n'
    return newCSV;
}

async function writeCSV(filePath, data){
    // let fullPath = `./data/${folderName}/${fileName}.csv`;
    await fsPromise.writeFile(filePath, data, {flag:"a+"}, err =>{
        if(err){
            console.error(err);
        }
    })
}

async function addtoCSV(filePath,data, delimiter){
    fs.mkdirSync(require('path').dirname(filePath), { recursive: true });
    const ws = fs.createWriteStream(filePath, { flags: 'a' });
    const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    
    // Write to CSV with fast-csv
    fastcsv
    .write(data, { headers: !fileExists, includeEndRowDelimiter: true, delimiter: delimiter, writeBOM: true })
    .pipe(ws);
  }
  

//function to delete the one file
async function clearCsvFile(directory){
    try {
        // const file = await readdir(directory);
        await unlink(directory);
        
      } catch(err) {
        console.log(err);
      }

}
//function to delete the folder
async function clearCsvFolder(directory){
    try {
        const files = await readdir(directory);
        const unlinkPromises = files.map(filename => unlink(`${directory}/${filename}`));
        await Promise.all(unlinkPromises);
        //this doesn't work? no permission
        //should delete the directory
        //will investigate if the main function doesn't work if folder already exists
        //await unlink(directory)
      } catch(err) {
        console.log(err);
      }
}

async function sanitizeData(file){
  const results = new Map();
  let duplicates = 0;
  let newMeets = 0;
  let duplicateArr = []

  console.log('sanitizing')
  return new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .pipe(csv({separator: "|"}))
        .on('data',(data)=>{
          let meetData;
          if(!data.Level){
              let [meet,level,date,resultsNo,url] = data.Meet.split('|')
              meet = meet.replaceAll('"','')

              meetData = {
                  Meet:meet,
                  Level:level,
                  Date: date,
                  Results: resultsNo,
                  "Meet Url": url
              }
          }else{
              meetData = data
          }
          if(!results.has(meetData["Meet Url"])){
              newMeets++;
              results.set(meetData["Meet Url"], meetData)
          }else{  
              duplicateArr.push(meetData['Meet Url'])
              duplicates++;
          }
        })
        .on('end',()=>{
          console.log(`new meets: ${newMeets}`);
          // console.log(`duplicate meets: ${duplicates}`);
          console.log(results.size)
          
          // let resultsArr = Array.from(results)
        
          const urls = Array.from(results).map((el)=>el[0])


          fs.writeFile(file, mapToString(results), "utf-8",(err)=>{
              if(err) console.log(err);
              else {
                  console.log('data saved')
                  resolve(urls)
              }
          })
      
          // resolve(results)
          // console.log(duplicateArr.join(' '))
        })
        .on('error',(err)=>{
          console.log(err)
          reject(err);
        })
      
  })
}

async function checkData(file, index){
  const results = new Map();
  let duplicates = 0;
  let allMeets = 0;
  let newMeets = 0;
  let duplicateArr = []

  console.log('checking file')
  return new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .pipe(csv({separator: "|"}))
        .on('data',(data)=>{
          allMeets++;
          let meetData;
          if(!data.Level){
              let [meet,level,date,resultsNo,url] = data.Meet.split('|')
              meet = meet.replaceAll('"','')

              meetData = {
                  Meet:meet,
                  Level:level,
                  Date: date,
                  Results: resultsNo,
                  "Meet Url": url
              }
          }else{
              meetData = data
          }
          if(!results.has(meetData["Meet Url"])){
              newMeets++;
              results.set(meetData["Meet Url"], meetData)
          }else{  
              //console.log(meetData)
              duplicateArr.push(meetData['Meet Url'])
              duplicates++;
          }
        })
        .on('end',()=>{
          // console.log(`new meets: ${newMeets}`);
          // console.log(`duplicate meets: ${duplicateArr}`);
          // console.log(`duplicate meets: ${duplicates}`);
          // console.log('non duplicate results: ' + results.size)
          // console.log('all meets: ' + allMeets)

          //write new file here
          fs.writeFile(`./scraped_data/sanitized_${index}.csv`, mapToString(results), "utf-8",(err)=>{
            if(err) console.log(err);
            else {
                console.log('data saved')
                resolve(results)
            }
          })
        })
        .on('error',(err)=>{
          console.log(err)
          reject(err);
        })
      
  })
}


async function compareCsvs(latest,old,output){
  console.log('comparing')
  let newMeets = [];
  let oldMeets = [];
  //read all of old metadata csv
  //store in variable 
  return new Promise((resolve, reject) => {
  fs.createReadStream(old)
  .pipe(csv({ separator: "|" }))
  .on('data',(data)=>{
      oldMeets.push(data)
  })
  .on('end',()=>{
      fs.createReadStream(latest)
      .pipe(csv({ separator: "|" }))
      .on('data',(data)=>{
          newMeets.push(data);
      })
      .on('end',()=>{
          const isNotInFirstArray = (element) => {
              return !oldMeets.some(item =>
                item.Meet === element.Meet &&
                item.Level === element.Level &&
                item.Date === element.Date &&
                item.Results === element.Results &&
                item['Meet Url'] === element['Meet Url']
              );
            };
      
          console.log('done comapring')
          //get new meets from the 2 meets
          const unmatched = newMeets.filter(isNotInFirstArray);
          const urls = unmatched.map((el)=>{
            return el['Meet Url']
          })
          console.log(urls.length)

          //transform to string to write ascsv
          const csvData = 'Meet|Level|Date|Results|Meet Url\n' + unmatched.map(element =>
              `${element.Meet}|${element.Level}|${element.Date}|${element.Results}|${element['Meet Url']}`
            ).join('\n');

          //write as csv
          fs.writeFile(output, csvData , "utf-8",(err)=>{
              if(err) console.log(err);
              else{
                  console.log('data saved')
                  resolve(urls)
              }
          })
      })
      .on('error',(err)=>{
          console.log(err)
          reject(err);
      })
  })
  .on('error',(err)=>{
      console.log(err)
      reject(err);

  })
  })
}  

async function readCsv(filePath, separator) {
  // const readFileAsync = promisify(fs.readFile);

  try {
      // Read the CSV file as a stream
      const stream = fs.createReadStream(filePath)
          .pipe(csv({
            separator: separator,
          }));

      const data = [];

      // Wait for 'data' event to collect each row
      for await (const row of stream) {
          data.push(row);
      }

      return data;
  } catch (error) {
      throw new Error(error);
  }
}

async function appendToCsv(filePath, rowData) {
  try {
    // Check if the file exists, if not, create it
    let fileExists = true;
    try {
      await fsPromise.access(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        fileExists = false;
      } else {
        throw error;
      }
    }

    // If the file doesn't exist, create it with headers
    if (!fileExists) {
      await fsPromise.writeFile(filePath, rowData.join(',') + '\n');
    } else {
      // Otherwise, append data to the existing file
      await fsPromise.appendFile(filePath, rowData.join(',') + '\n');
    }

  } catch (error) {
    throw new Error('Error appending to CSV: ' + error.message);
  }
}

async function betterWriteCSV(filePath, data, headers,separator){
  //make the file if it doesn't exist
  console.log('write better csv')
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '');
  }

  try{
    const csvStream = fastcsv.format({headers:headers, delimiter:separator});
    const writableStream = fs.createWriteStream(filePath);
    
    writableStream.on('finish',()=>{
      console.log('done writing')
    }).on('error',(err)=>{
      console.log(err);
    });

    
    csvStream.pipe(writableStream);
    data.forEach((row)=> csvStream.write(row));
    csvStream.end();
  }catch(e){
    console.log(e);
  }
}

async function filterAlreadyScrapedMeets(allMetadataPath, alreadyScrapedPath){
  let allMeets = await readCsv(allMetadataPath, '|');
  let alreadyScraped = await readCsv(alreadyScrapedPath, '|');  
  
  const filteredMetadata = allMeets.filter(meta => {
    return !alreadyScraped.some(scraped => scraped['Meet Url'] === meta['Meet Url']); // Assuming 'id' is the unique identifier
  });

  return filteredMetadata;
}



module.exports={
    createCSVfromArray,
    writeCSV,
    extractMeetUrls,
    clearCsvFolder,
    clearCsvFile,
    sanitizeData,
    compareCsvs,
    checkData,
    readCsv,
    appendToCsv,
    betterWriteCSV,
    filterAlreadyScrapedMeets,
    addtoCSV,
}