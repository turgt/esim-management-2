'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TravelerBookings', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      agencyContractId: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'AgencyContracts', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT'
      },
      travelerName: { type: Sequelize.STRING, allowNull: false },
      travelerEmail: { type: Sequelize.STRING, allowNull: true },
      travelerPhone: { type: Sequelize.STRING, allowNull: true },
      agencyBookingRef: { type: Sequelize.STRING, allowNull: true },
      token: { type: Sequelize.STRING, allowNull: false, unique: true },
      dueDate: { type: Sequelize.DATE, allowNull: false },
      originalDueDate: { type: Sequelize.DATE, allowNull: false },
      changeCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM('pending_provisioning', 'provisioned', 'installed', 'cancelled', 'failed', 'expired'),
        allowNull: false, defaultValue: 'pending_provisioning'
      },
      airaloRequestId: { type: Sequelize.STRING, allowNull: true },
      esimId: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Esims', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL'
      },
      cancelledAt: { type: Sequelize.DATE, allowNull: true },
      cancelReason: { type: Sequelize.STRING, allowNull: true },
      provisionedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('TravelerBookings', ['token'], { name: 'idx_traveler_bookings_token', unique: true });
    await queryInterface.addIndex('TravelerBookings', ['agencyId'], { name: 'idx_traveler_bookings_agency' });
    await queryInterface.addIndex('TravelerBookings', ['airaloRequestId'], { name: 'idx_traveler_bookings_airalo_request' });
    await queryInterface.addIndex('TravelerBookings', ['status'], { name: 'idx_traveler_bookings_status' });
    await queryInterface.addIndex('TravelerBookings', ['agencyId', 'agencyBookingRef'], {
      name: 'idx_traveler_bookings_agency_ref',
      unique: true,
      where: queryInterface.sequelize.literal('"agencyBookingRef" IS NOT NULL')
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('TravelerBookings');
  }
};
