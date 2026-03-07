import nodemailer from 'nodemailer';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'email' });

let transporter = null;

function initTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    log.warn('SMTP not configured. Emails will be logged to console.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: parseInt(process.env.SMTP_PORT) === 465,
    auth: { user, pass }
  });

  return transporter;
}

async function sendMail(to, subject, html) {
  const transport = initTransporter();
  const from = process.env.SMTP_FROM || 'eSIM Hub <noreply@esimhub.com>';

  if (!transport) {
    log.info({ to, subject }, 'Email logged (no SMTP)');
    log.debug({ html }, 'Email body');
    return { logged: true };
  }

  try {
    const info = await transport.sendMail({ from, to, subject, html });
    log.info({ to, messageId: info.messageId }, 'Email sent');
    return info;
  } catch (error) {
    log.error({ err: error, to, subject }, 'Email send failed');
    log.info({ to, subject }, 'Email fallback logged');
    return { error: error.message, logged: true };
  }
}

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

export async function sendVerificationEmail(user, token) {
  const verifyUrl = `${APP_URL()}/auth/verify-email/${token}`;
  const html = `
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1e293b;">Welcome to eSIM Hub!</h2>
      <p style="color: #475569;">Hi ${user.displayName || user.username},</p>
      <p style="color: #475569;">Please verify your email address by clicking the button below:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${verifyUrl}" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600;">
          Verify Email
        </a>
      </div>
      <p style="color: #94a3b8; font-size: 14px;">Or copy this link: ${verifyUrl}</p>
      <p style="color: #94a3b8; font-size: 14px;">This link expires in 24 hours.</p>
    </div>
  `;
  return sendMail(user.email, 'Verify your email - eSIM Hub', html);
}

export async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${APP_URL()}/auth/reset-password/${token}`;
  const html = `
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1e293b;">Password Reset Request</h2>
      <p style="color: #475569;">Hi ${user.displayName || user.username},</p>
      <p style="color: #475569;">You requested a password reset. Click the button below to set a new password:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600;">
          Reset Password
        </a>
      </div>
      <p style="color: #94a3b8; font-size: 14px;">Or copy this link: ${resetUrl}</p>
      <p style="color: #94a3b8; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    </div>
  `;
  return sendMail(user.email, 'Password Reset - eSIM Hub', html);
}

export async function sendWelcomeEmail(user) {
  const html = `
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1e293b;">Welcome to eSIM Hub!</h2>
      <p style="color: #475569;">Hi ${user.displayName || user.username},</p>
      <p style="color: #475569;">Your account has been verified. You can now browse and manage eSIM plans.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL()}/offers" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600;">
          Browse eSIM Plans
        </a>
      </div>
    </div>
  `;
  return sendMail(user.email, 'Welcome to eSIM Hub!', html);
}

export async function sendEsimAssignedEmail(user, esim) {
  const html = `
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1e293b;">eSIM Assigned to You!</h2>
      <p style="color: #475569;">Hi ${user.displayName || user.username},</p>
      <p style="color: #475569;">An eSIM plan has been assigned to your account:</p>
      <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0;">
        <p style="margin: 8px 0;"><strong>Offer:</strong> ${esim.offerId}</p>
        ${esim.iccid ? `<p style="margin: 8px 0;"><strong>ICCID:</strong> ${esim.iccid}</p>` : ''}
        ${esim.brandName ? `<p style="margin: 8px 0;"><strong>Provider:</strong> ${esim.brandName}</p>` : ''}
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL()}/purchases" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600;">
          View My eSIMs
        </a>
      </div>
    </div>
  `;
  return sendMail(user.email, 'eSIM Assigned - eSIM Hub', html);
}

export default { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail, sendEsimAssignedEmail };
