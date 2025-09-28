'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Esim extends Model {
    static associate(models){
      Esim.belongsTo(models.User,{foreignKey:'userId'});
    }
  }
  Esim.init({
    offerId:DataTypes.STRING,
    transactionId:DataTypes.STRING,
    status:DataTypes.STRING
  },{sequelize,modelName:'Esim'});
  return Esim;
};
