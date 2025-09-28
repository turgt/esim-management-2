'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models){
      User.hasMany(models.Esim,{foreignKey:'userId'});
    }
  }
  User.init({
    username:{type:DataTypes.STRING,unique:true,allowNull:false},
    passwordHash:{type:DataTypes.STRING,allowNull:false},
    isAdmin:{type:DataTypes.BOOLEAN,defaultValue:false},
    esimLimit:{type:DataTypes.INTEGER,allowNull:true}
  },{sequelize,modelName:'User'});
  return User;
};
