'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AgencyInvoice extends Model {
    static associate(models) {
      AgencyInvoice.belongsTo(models.Agency, { foreignKey: 'agencyId' });
    }
  }
  AgencyInvoice.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    periodStart: { type: DataTypes.DATEONLY, allowNull: false },
    periodEnd: { type: DataTypes.DATEONLY, allowNull: false },
    totalBookings: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    paymentStatus: { type: DataTypes.ENUM('pending', 'paid', 'overdue'), allowNull: false, defaultValue: 'pending' },
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, { sequelize, modelName: 'AgencyInvoice' });
  return AgencyInvoice;
};
