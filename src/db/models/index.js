'use strict';
import fs from 'fs';
import path from 'path';
import Sequelize from 'sequelize';
import { fileURLToPath } from 'url';
import configFile from '../config.json' assert { type:'json'};

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const env=process.env.NODE_ENV||'development';
const config=configFile[env];

const sequelize=new Sequelize(process.env.DATABASE_URL,config);
const db={};

for(const file of fs.readdirSync(__dirname)){
  if(file!=='index.js' && file.endsWith('.js')){
    const module=await import(path.join(__dirname,file));
    const model=module.default(sequelize,Sequelize.DataTypes);
    db[model.name]=model;
  }
}

Object.keys(db).forEach(n=>{ if(db[n].associate) db[n].associate(db); });

db.sequelize=sequelize;
db.Sequelize=Sequelize;
export default db;
