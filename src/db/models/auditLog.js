import { DataTypes } from 'sequelize';

export default function defineAuditLog(sequelize, DataTypesArg) {
  const AuditLog = sequelize.define('AuditLog', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false
    },
    entity: {
      type: DataTypes.STRING,
      allowNull: true
    },
    entityId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    details: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'AuditLogs',
    timestamps: true,
    updatedAt: false
  });

  return AuditLog;
}
