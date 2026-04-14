'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'agencyId', {
      type: Sequelize.INTEGER, allowNull: true,
      references: { model: 'Agencies', key: 'id' },
      onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('Users', 'agencyRole', {
      type: Sequelize.ENUM('owner', 'staff'), allowNull: true
    });
    await queryInterface.addIndex('Users', ['agencyId'], { name: 'idx_users_agency' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('Users', 'idx_users_agency');
    await queryInterface.removeColumn('Users', 'agencyRole');
    await queryInterface.removeColumn('Users', 'agencyId');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Users_agencyRole";');
  }
};
