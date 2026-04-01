'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'vendorId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Vendors', key: 'id' },
      onDelete: 'SET NULL'
    });

    await queryInterface.addIndex('Users', ['vendorId'], { name: 'idx_users_vendor_id' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Users', 'idx_users_vendor_id');
    await queryInterface.removeColumn('Users', 'vendorId');
  }
};
