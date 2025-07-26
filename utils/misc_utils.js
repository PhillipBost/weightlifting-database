async function getMultipleMeetResults(start, end, runFn){
    let noMeet = [];
    for(let i=start; i< end; i++){
        console.log('getting results for meet ' + i);
        let meetName = 'meet_' + i;
        try{
            //params are likely wrong
            await funFn(i, meetName);
        }catch(e){
            noMeet.push(i);
            console.error(e);
        }
    }

    console.log('no meets at ids \n' + noMeet);
}

async function multipleMissingMeets(missingArr,runFn){
    let noMeet = [];

    for(let meetUrl of missingArr){
        console.log('getting results for meet ' + meetUrl);
        let meetName = 'meet_' + meetUrl;
        try{
            //params are likely wrong
            await runFn(meetUrl, meetName);
        }catch(e){
            noMeet.push(meetUrl);
            console.error(e);
        }
    }
    console.log('no meets at ids \n' + noMeet);
}


module.exports = {
    multipleMissingMeets,
    getMultipleMeetResults,
}