'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class TravelerBooking extends Model {
    static associate(models) {
      TravelerBooking.belongsTo(models.Agency, { foreignKey: 'agencyId' });
      TravelerBooking.belongsTo(models.AgencyContract, { foreignKey: 'agencyContractId', as: 'contract' });
      TravelerBooking.belongsTo(models.Esim, { foreignKey: 'esimId', as: 'esim' });
      TravelerBooking.hasMany(models.AiraloWebhookLog, { foreignKey: 'travelerBookingId', as: 'webhookLogs' });
    }
  }
  TravelerBooking.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    agencyContractId: { type: DataTypes.INTEGER, allowNull: false },
    travelerName: { type: DataTypes.STRING, allowNull: false },
    travelerEmail: { type: DataTypes.STRING, allowNull: true },
    travelerPhone: { type: DataTypes.STRING, allowNull: true },
    agencyBookingRef: { type: DataTypes.STRING, allowNull: true },
    token: { type: DataTypes.STRING, allowNull: false, unique: true },
    dueDate: { type: DataTypes.DATE, allowNull: false },
    originalDueDate: { type: DataTypes.DATE, allowNull: false },
    changeCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: {
      type: DataTypes.ENUM('pending_provisioning', 'provisioned', 'installed', 'cancelled', 'failed', 'expired'),
      allowNull: false, defaultValue: 'pending_provisioning'
    },
    airaloRequestId: { type: DataTypes.STRING, allowNull: true },
    esimId: { type: DataTypes.INTEGER, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelReason: { type: DataTypes.STRING, allowNull: true },
    provisionedAt: { type: DataTypes.DATE, allowNull: true }
  }, { sequelize, modelName: 'TravelerBooking' });
  return TravelerBooking;
};
