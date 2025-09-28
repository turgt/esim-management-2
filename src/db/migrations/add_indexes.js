'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Primary performance indexes
    await queryInterface.addIndex('Esims', ['userId'], {
      name: 'idx_esims_user_id'
    });
    
    await queryInterface.addIndex('Esims', ['transactionId'], {
      name: 'idx_esims_transaction_id',
      unique: true
    });
    
    await queryInterface.addIndex('Esims', ['status'], {
      name: 'idx_esims_status'
    });
    
    await queryInterface.addIndex('Esims', ['userId', 'status'], {
      name: 'idx_esims_user_status'
    });
    
    await queryInterface.addIndex('Esims', ['createdAt'], {
      name: 'idx_esims_created_at'
    });
    
    await queryInterface.addIndex('Users', ['username'], {
      name: 'idx_users_username',
      unique: true
    });
    
    console.log('✅ Database indexes created successfully');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('Esims', 'idx_esims_user_id');
    await queryInterface.removeIndex('Esims', 'idx_esims_transaction_id');
    await queryInterface.removeIndex('Esims', 'idx_esims_status');
    await queryInterface.removeIndex('Esims', 'idx_esims_user_status');
    await queryInterface.removeIndex('Esims', 'idx_esims_created_at');
    await queryInterface.removeIndex('Users', 'idx_users_username');
  }
};