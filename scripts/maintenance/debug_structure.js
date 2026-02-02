const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../../temp/sanctions_dump.html');
const content = fs.readFileSync(filePath, 'utf8');
const $ = cheerio.load(content);

console.log('Index,Title,ParentTag,ParentClass,DirectCards');
$('.results__title').each((i, el) => {
    const title = $(el).text().trim();
    const parent = $(el).parent();
    const nextEl = $(el).next('.cards');

    // Check if nextEl actually has cards as direct children
    const directCards = nextEl.children('.card').length;

    console.log(`${i},"${title}","${parent.get(0).tagName}","${parent.attr('class')}","${directCards}"`);
});
