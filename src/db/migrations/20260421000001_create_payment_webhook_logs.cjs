'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PaymentWebhookLogs', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      provider: { type: Sequelize.STRING, allowNull: false },
      eventType: { type: Sequelize.STRING, allowNull: true },
      signatureValid: { type: Sequelize.BOOLEAN, allowNull: true },
      processed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      error: { type: Sequelize.TEXT, allowNull: true },
      merchantOid: { type: Sequelize.STRING, allowNull: true },
      providerTransactionId: { type: Sequelize.STRING, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('PaymentWebhookLogs', ['provider', 'createdAt'], { name: 'idx_payment_webhook_logs_provider_created' });
    await queryInterface.addIndex('PaymentWebhookLogs', ['merchantOid'], { name: 'idx_payment_webhook_logs_merchant_oid' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('PaymentWebhookLogs');
  }
};
