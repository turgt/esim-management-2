'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.Esim, { foreignKey: 'userId' });
      User.hasMany(models.Payment, { foreignKey: 'userId' });
      User.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
      User.belongsTo(models.Agency, { foreignKey: 'agencyId', as: 'agency' });
    }
  }
  User.init({
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, unique: true, allowNull: true },
    emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    emailVerificationToken: { type: DataTypes.STRING, allowNull: true },
    emailVerificationExpires: { type: DataTypes.DATE, allowNull: true },
    passwordResetToken: { type: DataTypes.STRING, allowNull: true },
    passwordResetExpires: { type: DataTypes.DATE, allowNull: true },
    displayName: { type: DataTypes.STRING, allowNull: true },
    phone: { type: DataTypes.STRING, allowNull: true },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    isVendor: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    esimLimit: { type: DataTypes.INTEGER, allowNull: true },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    theme: { type: DataTypes.STRING, defaultValue: 'light' },
    vendorId: { type: DataTypes.INTEGER, allowNull: true },
    agencyId: { type: DataTypes.INTEGER, allowNull: true },
    agencyRole: { type: DataTypes.ENUM('owner', 'staff'), allowNull: true }
  }, { sequelize, modelName: 'User' });
  return User;
};
