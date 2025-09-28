'use strict';
const bcrypt = require('bcrypt');

module.exports = {
  async up (queryInterface, Sequelize) {
    const hash = await bcrypt.hash('admin123', 10);
    await queryInterface.bulkInsert('Users', [{
      username: 'admin',
      passwordHash: hash,
      isAdmin: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Users', { username: 'admin' });
  }
};
