'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_Payments_status" ADD VALUE IF NOT EXISTS 'cancelled';
    `);
  },

  async down() {
    // PostgreSQL does not support removing values from enums
  }
};
