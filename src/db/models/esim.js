'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Esim extends Model {
    static associate(models) {
      Esim.belongsTo(models.User, { foreignKey: 'userId', as: 'owner' });
      Esim.belongsTo(models.User, { foreignKey: 'assignedBy', as: 'assigner' });
      Esim.belongsTo(models.Esim, { foreignKey: 'parentEsimId', as: 'parentEsim' });
      Esim.hasMany(models.Esim, { foreignKey: 'parentEsimId', as: 'topups' });
      Esim.hasMany(models.Payment, { foreignKey: 'esimId' });
      Esim.belongsTo(models.TravelerBooking, { foreignKey: 'travelerBookingId', as: 'booking' });
    }
  }
  Esim.init({
    offerId: DataTypes.STRING,
    transactionId: DataTypes.STRING,
    status: DataTypes.STRING,
    iccid: { type: DataTypes.STRING, allowNull: true },
    smdpAddress: { type: DataTypes.STRING, allowNull: true },
    activationCode: { type: DataTypes.STRING, allowNull: true },
    assignedBy: { type: DataTypes.INTEGER, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    dataGB: { type: DataTypes.FLOAT, allowNull: true },
    durationDays: { type: DataTypes.INTEGER, allowNull: true },
    brandName: { type: DataTypes.STRING, allowNull: true },
    parentEsimId: { type: DataTypes.INTEGER, allowNull: true },
    priceAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    priceCurrency: { type: DataTypes.STRING, allowNull: true },
    vendor: { type: DataTypes.STRING, allowNull: false, defaultValue: 'airalo' },
    vendorOrderId: { type: DataTypes.STRING, allowNull: true },
    vendorData: { type: DataTypes.JSONB, allowNull: true },
    travelerBookingId: { type: DataTypes.INTEGER, allowNull: true }
  }, { sequelize, modelName: 'Esim' });
  return Esim;
};
