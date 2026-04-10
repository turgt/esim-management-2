'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AiraloPackage extends Model {
    static associate(models) {
      // No associations needed
    }
  }
  AiraloPackage.init({
    packageId: { type: DataTypes.STRING, allowNull: false, unique: true },
    slug: { type: DataTypes.STRING, allowNull: false },
    countryCode: { type: DataTypes.STRING, allowNull: true },
    title: { type: DataTypes.STRING, allowNull: false },
    operatorTitle: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    data: { type: DataTypes.STRING, allowNull: false },
    day: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    netPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    isUnlimited: { type: DataTypes.BOOLEAN, defaultValue: false },
    voice: { type: DataTypes.INTEGER, allowNull: true },
    text: { type: DataTypes.INTEGER, allowNull: true },
    rechargeability: { type: DataTypes.BOOLEAN, defaultValue: false },
    imageUrl: { type: DataTypes.STRING, allowNull: true },
    rawData: { type: DataTypes.JSONB, allowNull: true },
    lastSyncedAt: { type: DataTypes.DATE, allowNull: true },
    overrideType: {
      type: DataTypes.ENUM('none', 'fixed', 'markup'),
      allowNull: false,
      defaultValue: 'none',
    },
    overrideValue: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },
  }, { sequelize, modelName: 'AiraloPackage' });
  return AiraloPackage;
};
