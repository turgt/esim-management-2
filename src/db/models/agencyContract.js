'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AgencyContract extends Model {
    static associate(models) {
      AgencyContract.belongsTo(models.Agency, { foreignKey: 'agencyId' });
      AgencyContract.belongsTo(models.AiraloPackage, { foreignKey: 'airaloPackageId', as: 'package' });
      AgencyContract.hasMany(models.TravelerBooking, { foreignKey: 'agencyContractId' });
    }
  }
  AgencyContract.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    airaloPackageId: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    usedQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unitPriceAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    unitPriceCurrency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    contractEndAt: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.ENUM('active', 'exhausted', 'expired', 'terminated'), allowNull: false, defaultValue: 'active' }
  }, { sequelize, modelName: 'AgencyContract' });
  return AgencyContract;
};
