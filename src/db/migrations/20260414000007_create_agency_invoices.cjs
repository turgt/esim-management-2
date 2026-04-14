'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AgencyInvoices', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      periodStart: { type: Sequelize.DATEONLY, allowNull: false },
      periodEnd: { type: Sequelize.DATEONLY, allowNull: false },
      totalBookings: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      totalAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
      paymentStatus: {
        type: Sequelize.ENUM('pending', 'paid', 'overdue'),
        allowNull: false, defaultValue: 'pending'
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('AgencyInvoices', ['agencyId'], { name: 'idx_agency_invoices_agency' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('AgencyInvoices');
  }
};
