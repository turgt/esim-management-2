'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Normalize existing Zendit statuses to internal statuses
    await queryInterface.sequelize.query(`
      UPDATE "Esims" SET status = 'completed' WHERE UPPER(status) IN ('DONE', 'ACCEPTED');
    `);
    await queryInterface.sequelize.query(`
      UPDATE "Esims" SET status = 'processing' WHERE UPPER(status) IN ('AUTHORIZED', 'IN_PROGRESS');
    `);
    await queryInterface.sequelize.query(`
      UPDATE "Esims" SET status = 'pending' WHERE UPPER(status) = 'PENDING';
    `);
    await queryInterface.sequelize.query(`
      UPDATE "Esims" SET status = 'failed' WHERE UPPER(status) IN ('FAILED', 'CANCELLED', 'REJECTED', 'ERROR');
    `);
  },

  async down(queryInterface, Sequelize) {
    // Cannot reliably reverse status normalization
  }
};
