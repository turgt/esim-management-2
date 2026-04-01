'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('EmailLogs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      to: { type: Sequelize.STRING, allowNull: false },
      subject: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      resendId: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, defaultValue: 'sent' },
      openedAt: { type: Sequelize.DATE, allowNull: true },
      clickedAt: { type: Sequelize.DATE, allowNull: true },
      bouncedAt: { type: Sequelize.DATE, allowNull: true },
      complainedAt: { type: Sequelize.DATE, allowNull: true },
      deliveredAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });

    await queryInterface.addIndex('EmailLogs', ['userId'], { name: 'idx_email_logs_user_id' });
    await queryInterface.addIndex('EmailLogs', ['resendId'], { name: 'idx_email_logs_resend_id' });
    await queryInterface.addIndex('EmailLogs', ['status'], { name: 'idx_email_logs_status' });
    await queryInterface.addIndex('EmailLogs', ['type'], { name: 'idx_email_logs_type' });
    await queryInterface.addIndex('EmailLogs', ['createdAt'], { name: 'idx_email_logs_created_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('EmailLogs');
  }
};
