'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Esims', 'vendor', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'zendit'
    });
    await queryInterface.addColumn('Esims', 'vendorOrderId', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'vendorData', {
      type: Sequelize.JSONB,
      allowNull: true
    });
    await queryInterface.addIndex('Esims', ['vendor'], {
      name: 'idx_esims_vendor'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Esims', 'idx_esims_vendor');
    await queryInterface.removeColumn('Esims', 'vendorData');
    await queryInterface.removeColumn('Esims', 'vendorOrderId');
    await queryInterface.removeColumn('Esims', 'vendor');
  }
};
