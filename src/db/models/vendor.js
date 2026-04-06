'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Vendor extends Model {
    static associate(models) {
      Vendor.hasMany(models.User, { foreignKey: 'vendorId', as: 'referredUsers' });
      Vendor.belongsTo(models.User, { foreignKey: 'userId', as: 'manager' });
    }
  }
  Vendor.init({
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, unique: true, allowNull: false },
    commissionRate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    contactInfo: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    userId: { type: DataTypes.INTEGER, allowNull: true }
  }, { sequelize, modelName: 'Vendor' });
  return Vendor;
};
