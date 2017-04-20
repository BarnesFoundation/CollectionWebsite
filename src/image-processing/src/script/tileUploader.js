const path = require('path');
const config = require('config');
const eachSeries = require('async/eachSeries');
const s3 = require('s3');
const csv = require('fast-csv');
const fs = require('fs');
const tmp = require('tmp');
const { exec, execSync } = require('child_process');

const UpdateEmitter = require('../../../util/updateEmitter.js');
const logger = require('../script/imageLogger.js');
const { getLastCompletedCSV, csvForEach } = require('../../../util/csvUtil.js');
const credentials = config.Credentials.aws;

class TileUploader extends UpdateEmitter {
  constructor(pathToAvailableImages, csvDir) {
    super();
    const resolvedPath = path.resolve(pathToAvailableImages);
    this._availableImages = require(resolvedPath).images;
    this._s3Client = s3.createClient({
      s3Options: {
        accessKeyId: credentials.awsAccessKeyId,
        secretAccessKey: credentials.awsSecretAccessKey,
        region: credentials.awsRegion
      }
    });
    this._tiledImages = null;
    this._csvDir = csvDir;
  }

  init() {
    return this._fetchTiledImages();
  }

  process() {
    return new Promise((resolve) => {
      this._isRunning = true;
      this.started();
      const lastCSV = getLastCompletedCSV(this._csvDir);
      const csvPath = path.join(this._csvDir, lastCSV, 'objects.csv');
      const imagesToTile = [];
      csvForEach(csvPath, (row) => {
        const img = this._imageNeedsUpload(`${row.invno}.jpg`);
        if (img) {
          imagesToTile.push(img);
        }
      },
      () => {
        this._tileAndUpload(imagesToTile);
        this._updateTiledList(imagesToTile).then(() => {
          this._isRunning = false;
          this.completed();
          resolve();
        });
      });
    });
  }

  _fetchTiledImages() {
    logger.info('Starting to fetch images already tiled.');
    this._tiledImages = [];
    return new Promise((resolve) => {
      this._s3Client.downloadFile({
        s3Params: {
          Bucket: credentials.awsBucket,
          Key: 'tiled.csv',
        },
        localFile: path.resolve(__dirname, '../../tiled.csv'),
      })
      .on('error', (err) => {
        if (err.message.includes('404')) {
          logger.info('Can\'t fetch list of tiled images--hasn\'t been created yet.');
          this._tiledImages = [];
          resolve();
        } else {
          throw err;
        }
      })
      .on('end', () => {
        logger.info('tiles.csv has been downloaded--loading into memory.');
        csvForEach(path.resolve(__dirname, '../../tiled.csv'), (data) => {
          this._tiledImages.push({ name: data.name, size: data.size, modified: data.modified });
        }, () => {
          this.progress();
          resolve();
        });
      });
    });
  }

  _imageNeedsUpload(imgName) {
    logger.info(`Checking if image ${imgName} needs upload.`);
    const s3Found = this._tiledImages.find(element => element.name.toLowerCase() === imgName.toLowerCase());
    const tmsFound = this._availableImages.find(element => element.name.toLowerCase() === imgName.toLowerCase());

    if (tmsFound) {
      if (s3Found && (s3Found.size !== tmsFound.size || s3Found.modified !== tmsFound.modified)) {
        logger.info(`${imgName} is available on TMS, has already been tiled, but has changed.`);
        return tmsFound;
      } else if (!s3Found) {
        logger.info(`${imgName} is available on TMS, but never has been tiled.`);
        return tmsFound;
      }
      logger.info(`${imgName} is available on TMS, has been tiled, and has not changed.`);
      return false;
    }
    logger.info(`${imgName} is not available on TMS.`);
    return false;
  }

  _tempConfigPath() {
    const tmpDir = tmp.dirSync().name;
    const iiifConfig = config.Images.IIIF;
    const outPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(outPath, JSON.stringify(iiifConfig));
    return outPath;
  }

  _tileAndUpload(images) {
    const configPath = this._tempConfigPath();
    const goPath = path.relative(process.cwd(), path.resolve(__dirname, '../../go-iiif/bin/iiif-tile-seed'));
    this._numImagesToProcess = images.length;
    this.progress();
    images.forEach((image, index) => {
      this._currentStep = `Tiling image: ${image.name}`;
      this.progress();
      logger.info(`Tiling image: ${image.name}, ${index + 1} of ${this._numImagesToProcess}`);
      const cmd = `${goPath} -config ${configPath} -endpoint http://barnes-image-repository.s3-website-us-east-1.amazonaws.com/tiles -verbose -loglevel debug ${image.name}`;
      execSync(cmd, (error, stdout, stderr) => {
        if (error) {
          logger.error(`exec error: ${error}`);
          return;
        }
        logger.info(`stdout: ${stdout}`);
        logger.error(`stderr: ${stderr}`);
      });
      this._numImagesProcessed = index + 1;
      this.progress();
    });
  }

  _updateTiledList(images) {
    const csvStream = csv.createWriteStream({ headers: true });
    const writableStream = fs.createWriteStream(path.resolve(__dirname, '../../tiled.csv'));

    return new Promise((resolve) => {
      writableStream.on('finish', () => {
        this._s3Client.uploadFile({
          localFile: path.resolve(__dirname, '../../tiled.csv'),
          s3Params: {
            Bucket: credentials.awsBucket,
            Key: 'tiled.csv',
          },
        })
        .on('end', () => {
          resolve();
        });
      });

      csvStream.pipe(writableStream);
      this._tiledImages.concat(images).forEach((img) => {
        csvStream.write(img);
      });
      csvStream.end();
    });
  }

}

module.exports = TileUploader;