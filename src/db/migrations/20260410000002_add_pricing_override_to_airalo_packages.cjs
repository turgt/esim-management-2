'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('AiraloPackages', 'overrideType', {
      type: Sequelize.ENUM('none', 'fixed', 'markup'),
      allowNull: false,
      defaultValue: 'none',
    });
    await queryInterface.addColumn('AiraloPackages', 'overrideValue', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('AiraloPackages', 'overrideValue');
    await queryInterface.removeColumn('AiraloPackages', 'overrideType');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_AiraloPackages_overrideType";');
  },
};
