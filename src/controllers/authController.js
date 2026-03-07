import db from '../db/models/index.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../services/emailService.js';
import { logAudit, ACTIONS, getIp } from '../services/auditService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'auth' });

export async function showLogin(req, res) {
  const errors = req.session.validationErrors || [];
  const formData = req.session.formData || {};
  delete req.session.validationErrors;
  delete req.session.formData;
  res.render('login', { title: 'Login', error: null, errors, formData });
}

export async function login(req, res) {
  try {
    const { username, password } = req.body;
    const { Op } = db.Sequelize;

    const user = await db.User.findOne({
      where: {
        [Op.or]: [
          { username: username },
          { email: username }
        ]
      }
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.render('login', { title: 'Login', error: 'Invalid username/email or password', errors: [], formData: {} });
    }

    if (!user.isActive) {
      return res.render('login', { title: 'Login', error: 'Your account has been deactivated. Contact an administrator.', errors: [], formData: {} });
    }

    await user.update({ lastLoginAt: new Date() });

    const isDefaultPassword = await bcrypt.compare('admin123', user.passwordHash);

    req.session.user = {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      theme: user.theme || 'light',
      mustChangePassword: isDefaultPassword
    };

    await logAudit(ACTIONS.LOGIN, { userId: user.id, entity: 'User', entityId: user.id, ipAddress: getIp(req) });

    if (isDefaultPassword) {
      return res.redirect('/profile?changePassword=1');
    }

    res.redirect('/offers');
  } catch (err) {
    log.error({ err }, 'Login error');
    res.render('login', { title: 'Login', error: 'An error occurred during login', errors: [], formData: {} });
  }
}

export async function logout(req, res) {
  req.session.destroy(() => res.redirect('/auth/login'));
}

export async function showRegister(req, res) {
  const errors = req.session.validationErrors || [];
  const formData = req.session.formData || {};
  delete req.session.validationErrors;
  delete req.session.formData;
  res.render('register', { title: 'Register', errors, formData });
}

export async function register(req, res) {
  try {
    const { username, email, password, displayName } = req.body;

    const { Op } = db.Sequelize;
    const existing = await db.User.findOne({
      where: {
        [Op.or]: [
          { username },
          { email }
        ]
      }
    });

    if (existing) {
      const field = existing.username === username ? 'Username' : 'Email';
      req.session.validationErrors = [`${field} is already taken`];
      req.session.formData = { username, email, displayName };
      return res.redirect('/auth/register');
    }

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const hash = await bcrypt.hash(password, 10);

    const user = await db.User.create({
      username,
      email,
      passwordHash: hash,
      displayName: displayName || null,
      emailVerificationToken,
      emailVerificationExpires,
      isAdmin: false,
      isActive: true
    });

    await sendVerificationEmail(user, emailVerificationToken);

    await logAudit(ACTIONS.REGISTER, { userId: user.id, entity: 'User', entityId: user.id, ipAddress: getIp(req) });

    req.session.user = {
      id: user.id,
      username: user.username,
      isAdmin: false,
      displayName: user.displayName,
      email: user.email,
      emailVerified: false,
      theme: 'light'
    };

    res.redirect('/offers');
  } catch (err) {
    log.error({ err }, 'Register error');
    req.session.validationErrors = ['Registration failed. Please try again.'];
    req.session.formData = req.body;
    res.redirect('/auth/register');
  }
}

export async function verifyEmail(req, res) {
  try {
    const { token } = req.params;

    const user = await db.User.findOne({
      where: {
        emailVerificationToken: token,
        emailVerificationExpires: { [db.Sequelize.Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.render('verify-email', {
        title: 'Verify Email',
        success: false,
        message: 'Invalid or expired verification link.'
      });
    }

    await user.update({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null
    });

    if (req.session.user && req.session.user.id === user.id) {
      req.session.user.emailVerified = true;
    }

    await sendWelcomeEmail(user);

    res.render('verify-email', {
      title: 'Verify Email',
      success: true,
      message: 'Your email has been verified successfully!'
    });
  } catch (err) {
    log.error({ err }, 'Verify email error');
    res.render('verify-email', {
      title: 'Verify Email',
      success: false,
      message: 'An error occurred during verification.'
    });
  }
}

export async function showForgotPassword(req, res) {
  const errors = req.session.validationErrors || [];
  delete req.session.validationErrors;
  res.render('forgot-password', { title: 'Forgot Password', errors, success: false });
}

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    const user = await db.User.findOne({ where: { email } });

    if (!user) {
      return res.render('forgot-password', {
        title: 'Forgot Password',
        errors: [],
        success: true
      });
    }

    const passwordResetToken = crypto.randomBytes(32).toString('hex');
    const passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);

    await user.update({ passwordResetToken, passwordResetExpires });

    await sendPasswordResetEmail(user, passwordResetToken);

    res.render('forgot-password', {
      title: 'Forgot Password',
      errors: [],
      success: true
    });
  } catch (err) {
    log.error({ err }, 'Forgot password error');
    res.render('forgot-password', {
      title: 'Forgot Password',
      errors: ['An error occurred. Please try again.'],
      success: false
    });
  }
}

export async function showResetPassword(req, res) {
  const { token } = req.params;
  const errors = req.session.validationErrors || [];
  delete req.session.validationErrors;

  const user = await db.User.findOne({
    where: {
      passwordResetToken: token,
      passwordResetExpires: { [db.Sequelize.Op.gt]: new Date() }
    }
  });

  if (!user) {
    return res.render('reset-password', {
      title: 'Reset Password',
      token,
      errors: [],
      invalid: true
    });
  }

  res.render('reset-password', {
    title: 'Reset Password',
    token,
    errors,
    invalid: false
  });
}

export async function resetPassword(req, res) {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const user = await db.User.findOne({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { [db.Sequelize.Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.render('reset-password', {
        title: 'Reset Password',
        token,
        errors: ['Invalid or expired reset link.'],
        invalid: true
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await user.update({
      passwordHash: hash,
      passwordResetToken: null,
      passwordResetExpires: null
    });

    res.render('login', {
      title: 'Login',
      error: null,
      errors: [],
      formData: {},
      success: 'Password reset successfully. You can now log in.'
    });
  } catch (err) {
    log.error({ err }, 'Reset password error');
    req.session.validationErrors = ['An error occurred. Please try again.'];
    res.redirect(`/auth/reset-password/${req.params.token}`);
  }
}
