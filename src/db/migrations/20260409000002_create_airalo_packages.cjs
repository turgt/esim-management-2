'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AiraloPackages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      packageId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      slug: { type: Sequelize.STRING, allowNull: false },
      countryCode: { type: Sequelize.STRING, allowNull: true },
      title: { type: Sequelize.STRING, allowNull: false },
      operatorTitle: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      data: { type: Sequelize.STRING, allowNull: false },
      day: { type: Sequelize.INTEGER, allowNull: false },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      netPrice: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      isUnlimited: { type: Sequelize.BOOLEAN, defaultValue: false },
      voice: { type: Sequelize.INTEGER, allowNull: true },
      text: { type: Sequelize.INTEGER, allowNull: true },
      rechargeability: { type: Sequelize.BOOLEAN, defaultValue: false },
      imageUrl: { type: Sequelize.STRING, allowNull: true },
      rawData: { type: Sequelize.JSONB, allowNull: true },
      lastSyncedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('AiraloPackages', ['countryCode'], {
      name: 'idx_airalo_packages_country'
    });
    await queryInterface.addIndex('AiraloPackages', ['type'], {
      name: 'idx_airalo_packages_type'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AiraloPackages');
  }
};
