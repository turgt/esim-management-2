'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AgencyContracts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      airaloPackageId: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'AiraloPackages', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      usedQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      unitPriceAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      unitPriceCurrency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
      contractEndAt: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('active', 'exhausted', 'expired', 'terminated'),
        allowNull: false, defaultValue: 'active'
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('AgencyContracts', ['agencyId'], { name: 'idx_agency_contracts_agency' });
    await queryInterface.addIndex('AgencyContracts', ['agencyId', 'airaloPackageId'], { name: 'idx_agency_contracts_agency_package' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('AgencyContracts');
  }
};
