'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AuditLogs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onDelete: 'SET NULL'
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false
      },
      entity: {
        type: Sequelize.STRING,
        allowNull: true
      },
      entityId: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      details: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      ipAddress: {
        type: Sequelize.STRING,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('AuditLogs', ['userId'], { name: 'idx_audit_logs_user_id' });
    await queryInterface.addIndex('AuditLogs', ['action'], { name: 'idx_audit_logs_action' });
    await queryInterface.addIndex('AuditLogs', ['createdAt'], { name: 'idx_audit_logs_created_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AuditLogs');
  }
};
