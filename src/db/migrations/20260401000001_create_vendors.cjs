'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Vendors', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING, unique: true, allowNull: false },
      commissionRate: { type: Sequelize.DECIMAL(5, 2), defaultValue: 0 },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      contactInfo: { type: Sequelize.STRING, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });

    await queryInterface.addIndex('Vendors', ['code'], { unique: true, name: 'idx_vendors_code' });
    await queryInterface.addIndex('Vendors', ['isActive'], { name: 'idx_vendors_active' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Vendors');
  }
};
