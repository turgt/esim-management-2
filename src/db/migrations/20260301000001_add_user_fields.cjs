'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'email', {
      type: Sequelize.STRING,
      unique: true,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'emailVerified', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
    await queryInterface.addColumn('Users', 'emailVerificationToken', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'emailVerificationExpires', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'passwordResetToken', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'passwordResetExpires', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'displayName', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'phone', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'isActive', {
      type: Sequelize.BOOLEAN,
      defaultValue: true
    });
    await queryInterface.addColumn('Users', 'lastLoginAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('Users', 'theme', {
      type: Sequelize.STRING,
      defaultValue: 'light'
    });

    await queryInterface.addIndex('Users', ['email'], { name: 'idx_users_email', unique: true });
    await queryInterface.addIndex('Users', ['emailVerificationToken'], { name: 'idx_users_email_verification_token' });
    await queryInterface.addIndex('Users', ['passwordResetToken'], { name: 'idx_users_password_reset_token' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Users', 'idx_users_password_reset_token');
    await queryInterface.removeIndex('Users', 'idx_users_email_verification_token');
    await queryInterface.removeIndex('Users', 'idx_users_email');
    await queryInterface.removeColumn('Users', 'theme');
    await queryInterface.removeColumn('Users', 'lastLoginAt');
    await queryInterface.removeColumn('Users', 'isActive');
    await queryInterface.removeColumn('Users', 'phone');
    await queryInterface.removeColumn('Users', 'displayName');
    await queryInterface.removeColumn('Users', 'passwordResetExpires');
    await queryInterface.removeColumn('Users', 'passwordResetToken');
    await queryInterface.removeColumn('Users', 'emailVerificationExpires');
    await queryInterface.removeColumn('Users', 'emailVerificationToken');
    await queryInterface.removeColumn('Users', 'emailVerified');
    await queryInterface.removeColumn('Users', 'email');
  }
};
