'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Vendors', 'userId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await queryInterface.addIndex('Vendors', ['userId'], {
      name: 'idx_vendors_user_id'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Vendors', 'idx_vendors_user_id');
    await queryInterface.removeColumn('Vendors', 'userId');
  }
};
