import { Resend } from 'resend';
import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'email' });

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    log.warn('RESEND_API_KEY not configured. Emails will be logged to console.');
    return null;
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

async function sendMail(to, subject, html, { type = 'general', userId = null } = {}) {
  const client = getResendClient();
  const from = process.env.SMTP_FROM || 'DataPatch <noreply@datapatch.net>';

  if (!client) {
    log.info({ to, subject }, 'Email logged (no Resend API key)');
    log.debug({ html }, 'Email body');
    try {
      await db.EmailLog.create({ to, subject, type, userId, status: 'logged' });
    } catch (e) { /* ignore log errors */ }
    return { logged: true };
  }

  try {
    const { data, error } = await client.emails.send({ from, to, subject, html });

    if (error) {
      log.error({ err: error, to, subject }, 'Resend API error');
      try {
        await db.EmailLog.create({ to, subject, type, userId, status: 'failed', metadata: { error: error.message } });
      } catch (e) { /* ignore */ }
      return { error: error.message, logged: true };
    }

    log.info({ to, messageId: data.id }, 'Email sent via Resend');
    try {
      await db.EmailLog.create({ to, subject, type, userId, resendId: data.id, status: 'sent' });
    } catch (e) { /* ignore */ }
    return data;
  } catch (error) {
    log.error({ err: error, to, subject }, 'Email send failed');
    try {
      await db.EmailLog.create({ to, subject, type, userId, status: 'failed', metadata: { error: error.message } });
    } catch (e) { /* ignore */ }
    return { error: error.message, logged: true };
  }
}

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

// Branded email template wrapper
function emailLayout(content, { preheader = '' } = {}) {
  const url = APP_URL();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DataPatch</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <!-- Header with brand -->
        <tr><td style="background:linear-gradient(135deg,#ea580c,#f97316);padding:24px 32px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td style="vertical-align:middle;padding-right:10px;">
                <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);display:inline-block;text-align:center;line-height:36px;">
                  <span style="font-size:18px;color:#ffffff;">&#9679;</span>
                </div>
              </td>
              <td style="vertical-align:middle;">
                <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;font-weight:500;letter-spacing:3px;color:rgba(255,255,255,0.75);display:block;line-height:1;">DATA</span>
                <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:20px;font-weight:800;color:#ffffff;display:block;line-height:1.2;">PATCH</span>
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 32px 24px;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:0 32px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">DataPatch - eSIM management platform</p>
              <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">
                <a href="${url}/legal/privacy" style="color:#94a3b8;text-decoration:underline;">Privacy</a> &nbsp;|&nbsp;
                <a href="${url}/legal/terms" style="color:#94a3b8;text-decoration:underline;">Terms</a> &nbsp;|&nbsp;
                <a href="${url}/legal/kvkk" style="color:#94a3b8;text-decoration:underline;">KVKK</a>
              </p>
              <p style="margin:0;font-size:11px;color:#cbd5e1;">&copy; ${new Date().getFullYear()} DataPatch. All rights reserved.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function emailButton(href, label) {
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#ea580c,#f97316);color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">${label}</a>
  </div>`;
}

function emailInfoCard(rows, { bgColor = '#f8fafc', borderColor = '#e2e8f0' } = {}) {
  const rowsHtml = rows.map(r => `<tr><td style="padding:6px 0;font-size:14px;color:#64748b;width:100px;vertical-align:top;"><strong>${r.label}</strong></td><td style="padding:6px 0;font-size:14px;color:#1e293b;">${r.value}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bgColor};border:1px solid ${borderColor};border-radius:12px;margin:20px 0;padding:16px;">
    <tr><td style="padding:16px;">${`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>`}</td></tr>
  </table>`;
}

export async function sendVerificationEmail(user, token) {
  const verifyUrl = `${APP_URL()}/auth/verify-email/${token}`;
  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Welcome!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Please verify your email address by clicking the button below:</p>
    ${emailButton(verifyUrl, 'Verify Email')}
    <p style="color:#94a3b8;font-size:13px;word-break:break-all;">Or copy this link: ${verifyUrl}</p>
    <p style="color:#94a3b8;font-size:13px;">This link expires in 24 hours.</p>
  `, { preheader: 'Verify your email address' });
  return sendMail(user.email, 'Verify your email - DataPatch', html, { type: 'verification', userId: user.id });
}

export async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${APP_URL()}/auth/reset-password/${token}`;
  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Password Reset</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">You requested a password reset. Click the button below to set a new password:</p>
    ${emailButton(resetUrl, 'Reset Password')}
    <p style="color:#94a3b8;font-size:13px;word-break:break-all;">Or copy this link: ${resetUrl}</p>
    <p style="color:#94a3b8;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `, { preheader: 'Reset your password' });
  return sendMail(user.email, 'Password Reset - DataPatch', html, { type: 'password_reset', userId: user.id });
}

export async function sendWelcomeEmail(user) {
  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Welcome to DataPatch!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Your account has been verified. You can now browse and manage eSIM plans.</p>
    ${emailButton(`${APP_URL()}/offers`, 'Browse eSIM Plans')}
  `, { preheader: 'Your account is ready' });
  return sendMail(user.email, 'Welcome to DataPatch!', html, { type: 'welcome', userId: user.id });
}

export async function sendEsimAssignedEmail(user, esim) {
  const rows = [
    { label: 'Plan', value: esim.offerId },
  ];
  if (esim.iccid) rows.push({ label: 'ICCID', value: esim.iccid });
  if (esim.brandName) rows.push({ label: 'Provider', value: esim.brandName });

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Assigned!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">An eSIM plan has been assigned to your account:</p>
    ${emailInfoCard(rows)}
    ${emailButton(`${APP_URL()}/purchases`, 'View My eSIMs')}
  `, { preheader: 'A new eSIM has been assigned to your account' });
  return sendMail(user.email, 'eSIM Assigned - DataPatch', html, { type: 'esim_assigned', userId: user.id });
}

export async function sendPaymentSuccessEmail(user, payment, esim) {
  const rows = [
    { label: 'Order', value: payment.merchantOid },
    { label: 'Amount', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
    { label: 'Plan', value: payment.offerId },
  ];
  if (esim && esim.iccid) rows.push({ label: 'ICCID', value: esim.iccid });

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Payment Successful!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Your payment has been processed and your eSIM is being activated.</p>
    ${emailInfoCard(rows)}
    ${emailButton(`${APP_URL()}/purchases`, 'View My eSIMs')}
  `, { preheader: 'Your payment was successful' });
  return sendMail(user.email, 'Payment Successful - DataPatch', html, { type: 'payment_success', userId: user.id });
}

export async function sendPaymentFailedEmail(user, payment) {
  const rows = [
    { label: 'Order', value: payment.merchantOid },
    { label: 'Amount', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
    { label: 'Plan', value: payment.offerId },
  ];

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Payment Failed</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Unfortunately, your payment could not be processed. No charges were made to your account.</p>
    ${emailInfoCard(rows, { bgColor: '#fef2f2', borderColor: '#fecaca' })}
    ${emailButton(`${APP_URL()}/offers`, 'Try Again')}
  `, { preheader: 'Your payment could not be processed' });
  return sendMail(user.email, 'Payment Failed - DataPatch', html, { type: 'payment_failed', userId: user.id });
}

export async function sendEsimActivationFailedEmail(user, payment) {
  const rows = [
    { label: 'Order', value: payment.merchantOid },
    { label: 'Amount', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
    { label: 'Status', value: 'Payment received - eSIM pending manual activation' },
  ];

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Activation Issue</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Your payment was successful, but there was an issue activating your eSIM. Our team has been notified and will resolve this shortly.</p>
    ${emailInfoCard(rows, { bgColor: '#fffbeb', borderColor: '#fde68a' })}
    <p style="color:#475569;font-size:15px;line-height:1.6;">You do not need to take any action. We will contact you once the issue is resolved.</p>
  `, { preheader: 'eSIM activation issue - our team is on it' });
  await sendMail(user.email, 'eSIM Activation Issue - DataPatch', html, { type: 'esim_activation_failed', userId: user.id });

  // Also notify admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const adminRows = [
      { label: 'User', value: `${user.username} (${user.email})` },
      { label: 'Order', value: payment.merchantOid },
      { label: 'Amount', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
      { label: 'Plan', value: payment.offerId },
      { label: 'Error', value: payment.metadata?.esimPurchaseError || 'Unknown' },
    ];

    const adminHtml = emailLayout(`
      <h2 style="margin:0 0 16px;color:#dc2626;font-size:22px;">eSIM Purchase Failed After Payment</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;">An eSIM purchase failed after successful payment. Manual intervention is required.</p>
      ${emailInfoCard(adminRows, { bgColor: '#fef2f2', borderColor: '#fecaca' })}
      ${emailButton(`${APP_URL()}/admin/payments`, 'View in Admin Panel')}
    `, { preheader: 'ALERT: eSIM activation failed after payment' });
    await sendMail(adminEmail, 'ALERT: eSIM Purchase Failed - DataPatch', adminHtml, { type: 'admin_alert' });
  }
}

// Exported for use by booking/expiry emails
export { emailLayout, emailButton, emailInfoCard };

export async function sendReplyEmail(to, subject, html, { inReplyTo, userId, fromAddress } = {}) {
  const client = getResendClient();
  const defaultFrom = process.env.SMTP_FROM || 'DataPatch <noreply@datapatch.net>';
  const from = fromAddress ? `DataPatch <${fromAddress}>` : defaultFrom;

  if (!client) {
    log.info({ to, subject }, 'Reply email logged (no Resend API key)');
    try {
      await db.EmailLog.create({ to, subject, type: 'reply', userId, status: 'logged' });
    } catch (e) { /* ignore */ }
    return { logged: true };
  }

  try {
    const payload = { from, to, subject, html };
    if (inReplyTo) {
      payload.headers = { 'In-Reply-To': inReplyTo, 'References': inReplyTo };
    }
    const { data, error } = await client.emails.send(payload);

    if (error) {
      log.error({ err: error, to, subject }, 'Reply email send error');
      try {
        await db.EmailLog.create({ to, subject, type: 'reply', userId, status: 'failed', metadata: { error: error.message, inReplyTo } });
      } catch (e) { /* ignore */ }
      return { error: error.message };
    }

    log.info({ to, messageId: data.id }, 'Reply email sent');
    try {
      await db.EmailLog.create({ to, subject, type: 'reply', userId, resendId: data.id, status: 'sent', metadata: { inReplyTo } });
    } catch (e) { /* ignore */ }
    return data;
  } catch (err) {
    log.error({ err, to }, 'Reply email exception');
    throw err;
  }
}

// Send a test email for any template type
export async function sendTestEmail(templateType, targetEmail, user) {
  const mockUser = { id: user.id, username: user.username, displayName: user.displayName || user.username, email: targetEmail };
  const mockPayment = { merchantOid: 'TEST_' + Date.now(), amount: '29.99', currency: 'USD', offerId: 'test-7days-5gb', metadata: {} };
  const mockEsim = { offerId: 'test-7days-5gb', iccid: '8901234567890123456', brandName: 'Airalo' };
  const mockToken = 'test-token-' + Date.now();

  const templates = {
    verification: () => {
      const url = `${APP_URL()}/auth/verify-email/${mockToken}`;
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Welcome!</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Please verify your email address by clicking the button below:</p>
        ${emailButton(url, 'Verify Email')}
        <p style="color:#94a3b8;font-size:13px;word-break:break-all;">Or copy this link: ${url}</p>
        <p style="color:#94a3b8;font-size:13px;">This link expires in 24 hours.</p>
      `, { preheader: '[TEST] Verify your email address' });
      return sendMail(targetEmail, '[TEST] Verify your email - DataPatch', html, { type: 'test', userId: user.id });
    },
    password_reset: () => {
      const url = `${APP_URL()}/auth/reset-password/${mockToken}`;
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Password Reset</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">You requested a password reset. Click the button below to set a new password:</p>
        ${emailButton(url, 'Reset Password')}
        <p style="color:#94a3b8;font-size:13px;">This link expires in 1 hour.</p>
      `, { preheader: '[TEST] Reset your password' });
      return sendMail(targetEmail, '[TEST] Password Reset - DataPatch', html, { type: 'test', userId: user.id });
    },
    welcome: () => {
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Welcome to DataPatch!</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Your account has been verified. You can now browse and manage eSIM plans.</p>
        ${emailButton(`${APP_URL()}/offers`, 'Browse eSIM Plans')}
      `, { preheader: '[TEST] Your account is ready' });
      return sendMail(targetEmail, '[TEST] Welcome to DataPatch!', html, { type: 'test', userId: user.id });
    },
    esim_assigned: () => {
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Assigned!</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">An eSIM plan has been assigned to your account:</p>
        ${emailInfoCard([{ label: 'Plan', value: mockEsim.offerId }, { label: 'ICCID', value: mockEsim.iccid }, { label: 'Provider', value: mockEsim.brandName }])}
        ${emailButton(`${APP_URL()}/purchases`, 'View My eSIMs')}
      `, { preheader: '[TEST] eSIM assigned' });
      return sendMail(targetEmail, '[TEST] eSIM Assigned - DataPatch', html, { type: 'test', userId: user.id });
    },
    payment_success: () => {
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Payment Successful!</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Your payment has been processed and your eSIM is being activated.</p>
        ${emailInfoCard([{ label: 'Order', value: mockPayment.merchantOid }, { label: 'Amount', value: '29.99 USD' }, { label: 'Plan', value: mockPayment.offerId }])}
        ${emailButton(`${APP_URL()}/purchases`, 'View My eSIMs')}
      `, { preheader: '[TEST] Payment successful' });
      return sendMail(targetEmail, '[TEST] Payment Successful - DataPatch', html, { type: 'test', userId: user.id });
    },
    payment_failed: () => {
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Payment Failed</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Unfortunately, your payment could not be processed. No charges were made.</p>
        ${emailInfoCard([{ label: 'Order', value: mockPayment.merchantOid }, { label: 'Amount', value: '29.99 USD' }, { label: 'Plan', value: mockPayment.offerId }], { bgColor: '#fef2f2', borderColor: '#fecaca' })}
        ${emailButton(`${APP_URL()}/offers`, 'Try Again')}
      `, { preheader: '[TEST] Payment failed' });
      return sendMail(targetEmail, '[TEST] Payment Failed - DataPatch', html, { type: 'test', userId: user.id });
    },
    esim_activation_failed: () => {
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Activation Issue</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Your payment was successful, but there was an issue activating your eSIM.</p>
        ${emailInfoCard([{ label: 'Order', value: mockPayment.merchantOid }, { label: 'Amount', value: '29.99 USD' }, { label: 'Status', value: 'Pending manual activation' }], { bgColor: '#fffbeb', borderColor: '#fde68a' })}
      `, { preheader: '[TEST] eSIM activation issue' });
      return sendMail(targetEmail, '[TEST] eSIM Activation Issue - DataPatch', html, { type: 'test', userId: user.id });
    },
    booking_created: () => {
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Booking Confirmed</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Your eSIM will be ready on <strong>January 15, 2026</strong>.</p>
        ${emailInfoCard([{ label: 'Date', value: 'January 15, 2026' }, { label: 'Status', value: 'Preparing' }])}
        ${emailButton(`${APP_URL()}/offers`, 'Set Up eSIM')}
      `, { preheader: '[TEST] Booking confirmed' });
      return sendMail(targetEmail, '[TEST] eSIM Booking Confirmed - DataPatch', html, { type: 'test', userId: user.id });
    },
    expiry_reminder: () => {
      const html = emailLayout(`
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Your eSIM Setup Is Expiring Soon!</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;">Hi ${mockUser.displayName},</p>
        <p style="color:#475569;font-size:15px;line-height:1.6;">You have <strong>5 days</strong> left to set up your eSIM.</p>
        ${emailButton(`${APP_URL()}/offers`, 'Set Up eSIM')}
        <p style="color:#94a3b8;font-size:13px;">eSIMs not set up within 30 days will expire.</p>
      `, { preheader: '[TEST] 5 days left to set up eSIM' });
      return sendMail(targetEmail, '[TEST] eSIM Setup Reminder - DataPatch', html, { type: 'test', userId: user.id });
    }
  };

  const fn = templates[templateType];
  if (!fn) throw new Error(`Unknown template type: ${templateType}`);
  return fn();
}

export const TEST_TEMPLATE_TYPES = [
  { value: 'verification', label: 'Email Verification' },
  { value: 'password_reset', label: 'Password Reset' },
  { value: 'welcome', label: 'Welcome' },
  { value: 'esim_assigned', label: 'eSIM Assigned' },
  { value: 'payment_success', label: 'Payment Success' },
  { value: 'payment_failed', label: 'Payment Failed' },
  { value: 'esim_activation_failed', label: 'eSIM Activation Failed' },
  { value: 'booking_created', label: 'Booking Confirmed' },
  { value: 'expiry_reminder', label: 'Expiry Reminder' },
];

export default {
  sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail,
  sendEsimAssignedEmail, sendPaymentSuccessEmail, sendPaymentFailedEmail,
  sendEsimActivationFailedEmail, sendReplyEmail, sendTestEmail
};
