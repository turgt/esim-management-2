'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Payments', 'offerId', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Payments', 'merchantOid', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Payments', 'merchantOid');
    await queryInterface.removeColumn('Payments', 'offerId');
  }
};
