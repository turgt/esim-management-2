'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Setting extends Model {
    static associate(models) {
      // No associations
    }
  }
  Setting.init({
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
      unique: true,
    },
    value: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  }, { sequelize, modelName: 'Setting' });
  return Setting;
};
