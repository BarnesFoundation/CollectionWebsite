// const TMSExporter = require('./tmsExporter.js');

// const argv = require('minimist')(process.argv.slice(2));

// const configFile = argv.config;
// const credfile = argv.creds;
// const config = require(configFile);

// const tmsExporter = new TMSExporter(credfile);

// tmsExporter.exportCSV(config).then(() => {
// 	console.log('All done!!');
// });

const config = require('config');
console.log(config.Images.IIIF.images);