'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AgencyApiKey extends Model {
    static associate(models) {
      AgencyApiKey.belongsTo(models.Agency, { foreignKey: 'agencyId' });
    }
  }
  AgencyApiKey.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    keyHash: { type: DataTypes.STRING, allowNull: false },
    keyPrefix: { type: DataTypes.STRING(12), allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.ENUM('active', 'revoked'), allowNull: false, defaultValue: 'active' },
    revokedAt: { type: DataTypes.DATE, allowNull: true }
  }, { sequelize, modelName: 'AgencyApiKey' });
  return AgencyApiKey;
};
