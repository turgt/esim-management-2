'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class PaymentWebhookLog extends Model {
    static associate() {}
  }
  PaymentWebhookLog.init({
    provider: { type: DataTypes.STRING, allowNull: false },
    eventType: { type: DataTypes.STRING, allowNull: true },
    signatureValid: { type: DataTypes.BOOLEAN, allowNull: true },
    processed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    error: { type: DataTypes.TEXT, allowNull: true },
    merchantOid: { type: DataTypes.STRING, allowNull: true },
    providerTransactionId: { type: DataTypes.STRING, allowNull: true },
    payload: { type: DataTypes.JSONB, allowNull: true }
  }, { sequelize, modelName: 'PaymentWebhookLog' });
  return PaymentWebhookLog;
};
