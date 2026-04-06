'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'isVendor', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false
    });
    await queryInterface.addIndex('Users', ['isVendor'], {
      name: 'idx_users_is_vendor'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Users', 'idx_users_is_vendor');
    await queryInterface.removeColumn('Users', 'isVendor');
  }
};
