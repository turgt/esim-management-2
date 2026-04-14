'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Esims', 'travelerBookingId', {
      type: Sequelize.INTEGER, allowNull: true,
      references: { model: 'TravelerBookings', key: 'id' },
      onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addIndex('Esims', ['travelerBookingId'], { name: 'idx_esims_traveler_booking' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('Esims', 'idx_esims_traveler_booking');
    await queryInterface.removeColumn('Esims', 'travelerBookingId');
  }
};
