'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Agencies', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, allowNull: false, unique: true },
      logoUrl: { type: Sequelize.STRING, allowNull: true },
      contactEmail: { type: Sequelize.STRING, allowNull: false },
      contactName: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: true },
      status: {
        type: Sequelize.ENUM('active', 'suspended'),
        allowNull: false,
        defaultValue: 'active'
      },
      settings: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('Agencies', ['slug'], { name: 'idx_agencies_slug', unique: true });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('Agencies');
  }
};
