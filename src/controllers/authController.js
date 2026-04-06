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
      isVendor: user.isVendor || false,
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

  // Capture vendor ref code from query param and store in session
  if (req.query.ref) {
    req.session.vendorRef = req.query.ref;
  }

  res.render('register', { title: 'Register', errors, formData, ref: req.session.vendorRef || null });
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

    // Look up vendor from ref code stored in session
    let vendorId = null;
    const vendorRef = req.session.vendorRef;
    if (vendorRef) {
      const vendor = await db.Vendor.findOne({ where: { code: vendorRef, isActive: true } });
      if (vendor) vendorId = vendor.id;
      delete req.session.vendorRef;
    }

    const user = await db.User.create({
      username,
      email,
      passwordHash: hash,
      displayName: displayName || null,
      emailVerificationToken,
      emailVerificationExpires,
      isAdmin: false,
      isActive: true,
      vendorId
    });

    await sendVerificationEmail(user, emailVerificationToken);

    await logAudit(ACTIONS.REGISTER, { userId: user.id, entity: 'User', entityId: user.id, ipAddress: getIp(req) });

    req.session.user = {
      id: user.id,
      username: user.username,
      isAdmin: false,
      isVendor: false,
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

export async function resendVerificationEmail(req, res) {
  try {
    const userId = req.session.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Rate limit: 2 minutes between resends
    const lastSent = req.session.lastVerificationEmailSent || 0;
    const cooldown = 2 * 60 * 1000; // 2 minutes
    const remaining = cooldown - (Date.now() - lastSent);
    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      return res.status(429).json({ error: `Please wait ${seconds} seconds before requesting again.` });
    }

    const user = await db.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.emailVerified) {
      return res.json({ message: 'Email is already verified.' });
    }

    // Generate new token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await user.update({ emailVerificationToken, emailVerificationExpires });
    await sendVerificationEmail(user, emailVerificationToken);

    req.session.lastVerificationEmailSent = Date.now();

    log.info({ userId: user.id, email: user.email }, 'Verification email resent');
    res.json({ message: 'Verification email sent. Please check your inbox.' });
  } catch (err) {
    log.error({ err }, 'Resend verification email error');
    res.status(500).json({ error: 'Failed to send verification email.' });
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
