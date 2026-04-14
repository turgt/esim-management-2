'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AiraloWebhookLogs', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      webhookType: { type: Sequelize.STRING, allowNull: false },
      airaloRequestId: { type: Sequelize.STRING, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false },
      travelerBookingId: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'TravelerBookings', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL'
      },
      processedAt: { type: Sequelize.DATE, allowNull: true },
      processStatus: {
        type: Sequelize.ENUM('pending', 'success', 'failed', 'retrying'),
        allowNull: false, defaultValue: 'pending'
      },
      error: { type: Sequelize.TEXT, allowNull: true },
      retryCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      receivedAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('AiraloWebhookLogs', ['airaloRequestId'], { name: 'idx_webhook_logs_airalo_request' });
    await queryInterface.addIndex('AiraloWebhookLogs', ['processStatus'], { name: 'idx_webhook_logs_status' });

    await queryInterface.createTable('AgencyApiKeys', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE'
      },
      keyHash: { type: Sequelize.STRING, allowNull: false },
      keyPrefix: { type: Sequelize.STRING(12), allowNull: false },
      label: { type: Sequelize.STRING, allowNull: false },
      lastUsedAt: { type: Sequelize.DATE, allowNull: true },
      status: {
        type: Sequelize.ENUM('active', 'revoked'),
        allowNull: false, defaultValue: 'active'
      },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('AgencyApiKeys', ['agencyId'], { name: 'idx_agency_api_keys_agency' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('AgencyApiKeys');
    await queryInterface.dropTable('AiraloWebhookLogs');
  }
};
