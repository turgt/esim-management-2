'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Payment extends Model {
    static associate(models) {
      Payment.belongsTo(models.User, { foreignKey: 'userId' });
      Payment.belongsTo(models.Esim, { foreignKey: 'esimId' });
    }
  }
  Payment.init({
    userId: { type: DataTypes.INTEGER, allowNull: false },
    esimId: { type: DataTypes.INTEGER, allowNull: true },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    currency: { type: DataTypes.STRING, defaultValue: 'TRY' },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed', 'refunded'),
      defaultValue: 'pending'
    },
    provider: { type: DataTypes.STRING, allowNull: true },
    providerTransactionId: { type: DataTypes.STRING, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: true }
  }, { sequelize, modelName: 'Payment' });
  return Payment;
};
