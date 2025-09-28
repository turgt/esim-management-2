'use strict';

import fs from 'fs';
import path from 'path';
import Sequelize from 'sequelize';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read config file dynamically
const configPath = path.join(__dirname, '../config.json');
const configData = fs.readFileSync(configPath, 'utf8');
const configFile = JSON.parse(configData);

const env = process.env.NODE_ENV || 'development';
const config = configFile[env];

console.log(`🔧 Database config loaded for environment: ${env}`);

// Create Sequelize instance
let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], {
    ...config,
    logging: config.logging !== false ? console.log : false
  });
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, {
    ...config,
    logging: config.logging !== false ? console.log : false
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

console.log(`📁 Loading ${modelFiles.length} model files:`, modelFiles);

// Import models dynamically
for (const file of modelFiles) {
  try {
    const modelPath = path.join(__dirname, file);
    const module = await import(`file://${modelPath}`);
    const model = module.default(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
    console.log(`✅ Model loaded: ${model.name}`);
  } catch (error) {
    console.error(`❌ Error loading model ${file}:`, error.message);
  }
}

// Associate models
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
    console.log(`🔗 Associations set for: ${modelName}`);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// Test database connection
try {
  await sequelize.authenticate();
  console.log('✅ Database connection established successfully');
} catch (error) {
  console.error('❌ Unable to connect to database:', error.message);
}

export default db;