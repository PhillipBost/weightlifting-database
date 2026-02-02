const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../../temp/sanctions_dump.html');

try {
    if (!fs.existsSync(filePath)) {
        console.error('Files does not exist:', filePath);
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const $ = cheerio.load(content);

    console.log('Parsing HTML...');

    const titles = $('.results__title');
    console.log(`Found ${titles.length} .results__title elements.`);

    titles.each((i, titleEl) => {
        const yearText = $(titleEl).find('h2').text().trim();
        const cardsContainer = $(titleEl).next('.cards');
        const cards = cardsContainer.find('.card').not('.card__legend');

        console.log(`Index ${i}: Year "${yearText}" - Cards Found: ${cards.length}`);

        if (i < 3 && cards.length > 0) {
            const firstCardName = cards.first().find('.col-md-4').eq(0).find('.col-7 p.title strong').text().trim();
            console.log(`   Sample Name: ${firstCardName}`);
        }
    });

} catch (err) {
    console.error(err);
}
