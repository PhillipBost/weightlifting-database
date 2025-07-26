function handleTotalAthleteString(str){
    let [curr, max] = str.split(' of ')
    curr = curr.split('-')[1]
    curr = parseInt(curr)
    max = parseInt(max)
    return curr < max;
}

function getAmountMeetsOnPage(str){
    let x = str.split(' of ')[0]
    let[low, up] = x.split('-');
    low = parseInt(low)
    up = parseInt(up)
    return up - low
}

module.exports ={
    getAmountMeetsOnPage,
    handleTotalAthleteString,
}
