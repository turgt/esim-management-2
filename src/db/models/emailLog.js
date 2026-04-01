'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class EmailLog extends Model {
    static associate(models) {
      EmailLog.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    }
  }
  EmailLog.init({
    userId: { type: DataTypes.INTEGER, allowNull: true },
    to: { type: DataTypes.STRING, allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    resendId: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, defaultValue: 'sent' },
    openedAt: { type: DataTypes.DATE, allowNull: true },
    clickedAt: { type: DataTypes.DATE, allowNull: true },
    bouncedAt: { type: DataTypes.DATE, allowNull: true },
    complainedAt: { type: DataTypes.DATE, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: true }
  }, { sequelize, modelName: 'EmailLog' });
  return EmailLog;
};
