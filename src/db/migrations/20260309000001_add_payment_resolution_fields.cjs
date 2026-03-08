'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Payments', 'resolvedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('Payments', 'resolvedBy', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    });
    await queryInterface.addColumn('Payments', 'resolutionNote', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('Payments', 'type', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'purchase'
    });
    await queryInterface.addColumn('Payments', 'targetIccid', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Payments', 'targetIccid');
    await queryInterface.removeColumn('Payments', 'type');
    await queryInterface.removeColumn('Payments', 'resolutionNote');
    await queryInterface.removeColumn('Payments', 'resolvedBy');
    await queryInterface.removeColumn('Payments', 'resolvedAt');
  }
};
