'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Agency extends Model {
    static associate(models) {
      Agency.hasMany(models.AgencyContract, { foreignKey: 'agencyId' });
      Agency.hasMany(models.TravelerBooking, { foreignKey: 'agencyId' });
      Agency.hasMany(models.User, { foreignKey: 'agencyId', as: 'users' });
      Agency.hasMany(models.AgencyApiKey, { foreignKey: 'agencyId' });
      Agency.hasMany(models.AgencyInvoice, { foreignKey: 'agencyId' });
    }
  }
  Agency.init({
    name: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false, unique: true },
    logoUrl: { type: DataTypes.STRING, allowNull: true },
    contactEmail: { type: DataTypes.STRING, allowNull: false },
    contactName: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM('active', 'suspended'), allowNull: false, defaultValue: 'active' },
    settings: { type: DataTypes.JSONB, allowNull: true, defaultValue: {} }
  }, { sequelize, modelName: 'Agency' });
  return Agency;
};
