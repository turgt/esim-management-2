'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AiraloWebhookLog extends Model {
    static associate(models) {
      AiraloWebhookLog.belongsTo(models.TravelerBooking, { foreignKey: 'travelerBookingId', as: 'booking' });
    }
  }
  AiraloWebhookLog.init({
    webhookType: { type: DataTypes.STRING, allowNull: false },
    airaloRequestId: { type: DataTypes.STRING, allowNull: true },
    payload: { type: DataTypes.JSONB, allowNull: false },
    travelerBookingId: { type: DataTypes.INTEGER, allowNull: true },
    processedAt: { type: DataTypes.DATE, allowNull: true },
    processStatus: { type: DataTypes.ENUM('pending', 'success', 'failed', 'retrying'), allowNull: false, defaultValue: 'pending' },
    error: { type: DataTypes.TEXT, allowNull: true },
    retryCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    receivedAt: { type: DataTypes.DATE, allowNull: false }
  }, { sequelize, modelName: 'AiraloWebhookLog' });
  return AiraloWebhookLog;
};
