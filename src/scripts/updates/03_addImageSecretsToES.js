const config = require('config');
const path = require('path');
const ESCollection = require('../../csv_es/src/script/esCollection.js');
const { makeElasticsearchOptions } = require('../../util/elasticOptions.js');

const esClient = new ESCollection(makeElasticsearchOptions(), config.CSV.imageSecretsPath);
const csvPath = path.join(config.CSV.imageSecretsPath, config.CSV.imageSecretsFilename);

esClient._updateESWithImageSecrets(csvPath);


