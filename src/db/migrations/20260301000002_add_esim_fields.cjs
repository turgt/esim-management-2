'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Esims', 'iccid', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'smdpAddress', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'activationCode', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'assignedBy', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    });
    await queryInterface.addColumn('Esims', 'country', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'dataGB', {
      type: Sequelize.FLOAT,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'durationDays', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'brandName', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'parentEsimId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Esims', key: 'id' }
    });
    await queryInterface.addColumn('Esims', 'priceAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'priceCurrency', {
      type: Sequelize.STRING,
      allowNull: true
    });

    await queryInterface.addIndex('Esims', ['iccid'], { name: 'idx_esims_iccid' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Esims', 'idx_esims_iccid');
    await queryInterface.removeColumn('Esims', 'priceCurrency');
    await queryInterface.removeColumn('Esims', 'priceAmount');
    await queryInterface.removeColumn('Esims', 'parentEsimId');
    await queryInterface.removeColumn('Esims', 'brandName');
    await queryInterface.removeColumn('Esims', 'durationDays');
    await queryInterface.removeColumn('Esims', 'dataGB');
    await queryInterface.removeColumn('Esims', 'country');
    await queryInterface.removeColumn('Esims', 'assignedBy');
    await queryInterface.removeColumn('Esims', 'activationCode');
    await queryInterface.removeColumn('Esims', 'smdpAddress');
    await queryInterface.removeColumn('Esims', 'iccid');
  }
};
