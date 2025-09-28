'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    console.log('🔧 Creating database indexes...');
    
    try {
      // Primary performance indexes
      await queryInterface.addIndex('Esims', ['userId'], {
        name: 'idx_esims_user_id'
      });
      console.log('✅ Created index: idx_esims_user_id');
      
      await queryInterface.addIndex('Esims', ['transactionId'], {
        name: 'idx_esims_transaction_id',
        unique: true
      });
      console.log('✅ Created index: idx_esims_transaction_id');
      
      await queryInterface.addIndex('Esims', ['status'], {
        name: 'idx_esims_status'
      });
      console.log('✅ Created index: idx_esims_status');
      
      await queryInterface.addIndex('Esims', ['userId', 'status'], {
        name: 'idx_esims_user_status'
      });
      console.log('✅ Created index: idx_esims_user_status');
      
      await queryInterface.addIndex('Esims', ['createdAt'], {
        name: 'idx_esims_created_at'
      });
      console.log('✅ Created index: idx_esims_created_at');
      
      // Check if Users table index already exists (from unique constraint)
      const indexes = await queryInterface.showIndex('Users');
      const usernameIndexExists = indexes.some(index => 
        index.name === 'idx_users_username' || 
        index.name === 'Users_username_key' ||
        index.fields.some(field => field.attribute === 'username')
      );
      
      if (!usernameIndexExists) {
        await queryInterface.addIndex('Users', ['username'], {
          name: 'idx_users_username',
          unique: true
        });
        console.log('✅ Created index: idx_users_username');
      } else {
        console.log('ℹ️ Username index already exists, skipping');
      }
      
      console.log('🎉 All database indexes created successfully');
      
    } catch (error) {
      console.error('❌ Error creating indexes:', error.message);
      
      // Check if it's just a duplicate index error
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        console.log('ℹ️ Some indexes already exist, continuing...');
      } else {
        throw error;
      }
    }
  },

  async down(queryInterface, Sequelize) {
    console.log('🗑️ Removing database indexes...');
    
    try {
      await queryInterface.removeIndex('Esims', 'idx_esims_user_id');
      console.log('🗑️ Removed index: idx_esims_user_id');
    } catch (e) {
      console.log('⚠️ Could not remove idx_esims_user_id:', e.message);
    }
    
    try {
      await queryInterface.removeIndex('Esims', 'idx_esims_transaction_id');
      console.log('🗑️ Removed index: idx_esims_transaction_id');
    } catch (e) {
      console.log('⚠️ Could not remove idx_esims_transaction_id:', e.message);
    }
    
    try {
      await queryInterface.removeIndex('Esims', 'idx_esims_status');
      console.log('🗑️ Removed index: idx_esims_status');
    } catch (e) {
      console.log('⚠️ Could not remove idx_esims_status:', e.message);
    }
    
    try {
      await queryInterface.removeIndex('Esims', 'idx_esims_user_status');
      console.log('🗑️ Removed index: idx_esims_user_status');
    } catch (e) {
      console.log('⚠️ Could not remove idx_esims_user_status:', e.message);
    }
    
    try {
      await queryInterface.removeIndex('Esims', 'idx_esims_created_at');
      console.log('🗑️ Removed index: idx_esims_created_at');
    } catch (e) {
      console.log('⚠️ Could not remove idx_esims_created_at:', e.message);
    }
    
    try {
      await queryInterface.removeIndex('Users', 'idx_users_username');
      console.log('🗑️ Removed index: idx_users_username');
    } catch (e) {
      console.log('⚠️ Could not remove idx_users_username:', e.message);
    }
    
    console.log('🧹 Index removal completed');
  }
};