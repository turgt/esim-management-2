'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Esims', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' } },
      offerId: Sequelize.STRING,
      transactionId: Sequelize.STRING,
      status: Sequelize.STRING,
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Esims');
  }
};
