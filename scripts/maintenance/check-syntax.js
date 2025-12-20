try {
    require('../production/database-importer-custom.js');
    console.log("Syntax OK");
} catch (e) {
    console.log(e.stack);
}
