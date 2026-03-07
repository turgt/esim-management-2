'use strict';

import fs from 'fs';
import path from 'path';
import Sequelize from 'sequelize';
import { fileURLToPath } from 'url';
import logger from '../../lib/logger.js';

const log = logger.child({ module: 'database' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read config file dynamically
const configPath = path.join(__dirname, '../config.json');
const configData = fs.readFileSync(configPath, 'utf8');
const configFile = JSON.parse(configData);

const env = process.env.NODE_ENV || 'development';
const config = configFile[env];

log.info({ env }, 'Database config loaded');

// Create Sequelize instance
let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], {
    ...config,
    logging: config.logging !== false ? (msg) => log.debug(msg) : false
  });
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, {
    ...config,
    logging: config.logging !== false ? (msg) => log.debug(msg) : false
  });
}

const db = {};

// Read all model files dynamically
const modelFiles = fs.readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== 'index.js' &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  });

log.debug({ count: modelFiles.length, files: modelFiles }, 'Loading model files');

// Import models dynamically
for (const file of modelFiles) {
  try {
    const modelPath = path.join(__dirname, file);
    const module = await import(`file://${modelPath}`);
    const model = module.default(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
    log.debug({ model: model.name }, 'Model loaded');
  } catch (error) {
    log.error({ file, err: error }, 'Error loading model');
  }
}

// Associate models
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
    log.debug({ model: modelName }, 'Associations set');
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// Test database connection
try {
  await sequelize.authenticate();
  log.info('Database connection established successfully');
} catch (error) {
  log.fatal({ err: error }, 'Unable to connect to database');
}

export default db;
