'use strict';
const bcrypt = require('bcrypt');

module.exports = {
  async up (queryInterface, Sequelize) {
    const [results] = await queryInterface.sequelize.query(
      "SELECT id FROM \"Users\" WHERE username = 'admin' LIMIT 1;"
    );

    if (results.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await queryInterface.bulkInsert('Users', [{
        username: 'admin',
        passwordHash: hash,
        isAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }]);
    } else {
      console.log("⚠️ Admin user already exists, skipping seeder.");
    }
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Users', { username: 'admin' });
  }
};
