import db from '../db/models/index.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { sendVerificationEmail } from '../services/emailService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'profile' });

export async function showProfile(req, res) {
  try {
    const user = await db.User.findByPk(req.session.user.id, {
      include: [{ model: db.Esim, foreignKey: 'userId' }]
    });

    const errors = req.session.validationErrors || [];
    const success = req.session.profileSuccess || null;
    delete req.session.validationErrors;
    delete req.session.profileSuccess;

    res.render('profile', {
      title: 'Profile',
      profile: user,
      esims: user.Esims || [],
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showProfile error');
    res.render('error', { message: 'Failed to load profile' });
  }
}

export async function updateProfile(req, res) {
  try {
    const user = await db.User.findByPk(req.session.user.id);
    const { displayName, phone, email, theme } = req.body;

    const updateData = {};

    if (displayName !== undefined) updateData.displayName = displayName || null;
    if (phone !== undefined) updateData.phone = phone || null;
    if (theme && ['light', 'dark'].includes(theme)) updateData.theme = theme;

    if (email && email !== user.email) {
      const existing = await db.User.findOne({ where: { email } });
      if (existing && existing.id !== user.id) {
        req.session.validationErrors = ['This email is already in use'];
        return res.redirect('/profile');
      }
      updateData.email = email;
      updateData.emailVerified = false;
      const token = crypto.randomBytes(32).toString('hex');
      updateData.emailVerificationToken = token;
      updateData.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await user.update(updateData);
      await sendVerificationEmail({ ...user.toJSON(), email }, token);
      req.session.user.displayName = user.displayName;
      req.session.user.email = email;
      req.session.user.emailVerified = false;
      if (updateData.theme) req.session.user.theme = updateData.theme;
      req.session.profileSuccess = 'Profile updated. A verification email has been sent to your new email address.';
      return res.redirect('/profile');
    }

    await user.update(updateData);

    req.session.user.displayName = user.displayName;
    req.session.user.email = user.email;
    req.session.user.emailVerified = user.emailVerified;
    if (updateData.theme) req.session.user.theme = updateData.theme;

    req.session.profileSuccess = 'Profile updated successfully';
    res.redirect('/profile');
  } catch (err) {
    log.error({ err }, 'updateProfile error');
    req.session.validationErrors = ['Failed to update profile'];
    res.redirect('/profile');
  }
}

export async function changePassword(req, res) {
  try {
    const user = await db.User.findByPk(req.session.user.id);
    const { currentPassword, newPassword } = req.body;

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      req.session.validationErrors = ['Current password is incorrect'];
      return res.redirect('/profile');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await user.update({ passwordHash: hash });

    if (req.session.user.mustChangePassword) {
      req.session.user.mustChangePassword = false;
    }

    req.session.profileSuccess = 'Password changed successfully';
    res.redirect('/profile');
  } catch (err) {
    log.error({ err }, 'changePassword error');
    req.session.validationErrors = ['Failed to change password'];
    res.redirect('/profile');
  }
}

export async function showMyEsims(req, res) {
  try {
    const esims = await db.Esim.findAll({
      where: { userId: req.session.user.id },
      include: [{ model: db.Esim, as: 'topups' }],
      order: [['createdAt', 'DESC']]
    });

    res.render('profile', {
      title: 'My eSIMs',
      profile: await db.User.findByPk(req.session.user.id),
      esims,
      errors: [],
      success: null,
      activeTab: 'esims'
    });
  } catch (err) {
    log.error({ err }, 'showMyEsims error');
    res.render('error', { message: 'Failed to load eSIMs' });
  }
}
