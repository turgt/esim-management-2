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
<html lang="tr">
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
              <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">DataPatch - eSIM yonetim platformu</p>
              <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">
                <a href="${url}/legal/privacy" style="color:#94a3b8;text-decoration:underline;">Gizlilik</a> &nbsp;|&nbsp;
                <a href="${url}/legal/terms" style="color:#94a3b8;text-decoration:underline;">Kosullar</a> &nbsp;|&nbsp;
                <a href="${url}/legal/kvkk" style="color:#94a3b8;text-decoration:underline;">KVKK</a>
              </p>
              <p style="margin:0;font-size:11px;color:#cbd5e1;">&copy; ${new Date().getFullYear()} DataPatch. Tum haklari saklidir.</p>
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
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Hosgeldiniz!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Lutfen asagidaki butona tiklayarak e-posta adresinizi dogrulayin:</p>
    ${emailButton(verifyUrl, 'E-postami Dogrula')}
    <p style="color:#94a3b8;font-size:13px;word-break:break-all;">Ya da bu linki kopyalayin: ${verifyUrl}</p>
    <p style="color:#94a3b8;font-size:13px;">Bu link 24 saat gecerlidir.</p>
  `, { preheader: 'E-posta adresinizi dogrulayin' });
  return sendMail(user.email, 'E-posta Dogrulama - DataPatch', html, { type: 'verification', userId: user.id });
}

export async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${APP_URL()}/auth/reset-password/${token}`;
  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Sifre Sifirlama</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Sifre sifirlama talebinde bulundunuz. Yeni sifrenizi belirlemek icin asagidaki butona tiklayin:</p>
    ${emailButton(resetUrl, 'Sifremi Sifirla')}
    <p style="color:#94a3b8;font-size:13px;word-break:break-all;">Ya da bu linki kopyalayin: ${resetUrl}</p>
    <p style="color:#94a3b8;font-size:13px;">Bu link 1 saat gecerlidir. Eger siz talep etmediyseniz bu e-postayi gormezden gelebilirsiniz.</p>
  `, { preheader: 'Sifrenizi sifirlayin' });
  return sendMail(user.email, 'Sifre Sifirlama - DataPatch', html, { type: 'password_reset', userId: user.id });
}

export async function sendWelcomeEmail(user) {
  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Hosgeldiniz!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hesabiniz dogrulandi. Artik eSIM planlarini goruntuleyebilir ve yonetebilirsiniz.</p>
    ${emailButton(`${APP_URL()}/offers`, 'eSIM Planlarina Goz At')}
  `, { preheader: 'Hesabiniz hazir, eSIM planlarina goz atin' });
  return sendMail(user.email, 'Hosgeldiniz - DataPatch', html, { type: 'welcome', userId: user.id });
}

export async function sendEsimAssignedEmail(user, esim) {
  const rows = [
    { label: 'Plan', value: esim.offerId },
  ];
  if (esim.iccid) rows.push({ label: 'ICCID', value: esim.iccid });
  if (esim.brandName) rows.push({ label: 'Saglayici', value: esim.brandName });

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Atandi!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Hesabiniza bir eSIM plani atandi:</p>
    ${emailInfoCard(rows)}
    ${emailButton(`${APP_URL()}/purchases`, 'eSIM\'lerimi Goruntule')}
  `, { preheader: 'Hesabiniza yeni bir eSIM atandi' });
  return sendMail(user.email, 'eSIM Atandi - DataPatch', html, { type: 'esim_assigned', userId: user.id });
}

export async function sendPaymentSuccessEmail(user, payment, esim) {
  const rows = [
    { label: 'Siparis', value: payment.merchantOid },
    { label: 'Tutar', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
    { label: 'Plan', value: payment.offerId },
  ];
  if (esim && esim.iccid) rows.push({ label: 'ICCID', value: esim.iccid });

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Odeme Basarili!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Odemeniz islendi ve eSIM'iniz aktive ediliyor.</p>
    ${emailInfoCard(rows)}
    ${emailButton(`${APP_URL()}/purchases`, 'eSIM\'lerimi Goruntule')}
  `, { preheader: 'Odemeniz basariyla islendi' });
  return sendMail(user.email, 'Odeme Basarili - DataPatch', html, { type: 'payment_success', userId: user.id });
}

export async function sendPaymentFailedEmail(user, payment) {
  const rows = [
    { label: 'Siparis', value: payment.merchantOid },
    { label: 'Tutar', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
    { label: 'Plan', value: payment.offerId },
  ];

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">Odeme Basarisiz</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Maalesef odemeniz islenemedi. Hesabinizdan herhangi bir ucret kesilmedi.</p>
    ${emailInfoCard(rows, { bgColor: '#fef2f2', borderColor: '#fecaca' })}
    ${emailButton(`${APP_URL()}/offers`, 'Tekrar Dene')}
  `, { preheader: 'Odemeniz islenemedi' });
  return sendMail(user.email, 'Odeme Basarisiz - DataPatch', html, { type: 'payment_failed', userId: user.id });
}

export async function sendEsimActivationFailedEmail(user, payment) {
  const rows = [
    { label: 'Siparis', value: payment.merchantOid },
    { label: 'Tutar', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
    { label: 'Durum', value: 'Odeme alindi - eSIM manuel aktivasyon bekliyor' },
  ];

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Aktivasyon Sorunu</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${user.displayName || user.username},</p>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Odemeniz basariyla alindi ancak eSIM'inizin aktivasyonunda bir sorun olustu. Ekibimiz bilgilendirildi ve en kisa surede cozecektir.</p>
    ${emailInfoCard(rows, { bgColor: '#fffbeb', borderColor: '#fde68a' })}
    <p style="color:#475569;font-size:15px;line-height:1.6;">Herhangi bir islem yapmaniza gerek yoktur. Sorun cozuldugunde sizinle iletisime gececegiz.</p>
  `, { preheader: 'eSIM aktivasyonunda sorun - ekibimiz ilgileniyor' });
  await sendMail(user.email, 'eSIM Aktivasyon Sorunu - DataPatch', html, { type: 'esim_activation_failed', userId: user.id });

  // Also notify admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const adminRows = [
      { label: 'Kullanici', value: `${user.username} (${user.email})` },
      { label: 'Siparis', value: payment.merchantOid },
      { label: 'Tutar', value: `${parseFloat(payment.amount).toFixed(2)} ${payment.currency}` },
      { label: 'Plan', value: payment.offerId },
      { label: 'Hata', value: payment.metadata?.esimPurchaseError || 'Bilinmiyor' },
    ];

    const adminHtml = emailLayout(`
      <h2 style="margin:0 0 16px;color:#dc2626;font-size:22px;">eSIM Satin Alma Hatasi</h2>
      <p style="color:#475569;font-size:15px;line-height:1.6;">Odeme sonrasi eSIM satin alma islemi basarisiz oldu. Manuel mudahale gerekiyor.</p>
      ${emailInfoCard(adminRows, { bgColor: '#fef2f2', borderColor: '#fecaca' })}
      ${emailButton(`${APP_URL()}/admin/payments`, 'Admin Panelinde Goruntule')}
    `, { preheader: 'UYARI: Odeme sonrasi eSIM aktivasyon hatasi' });
    await sendMail(adminEmail, 'UYARI: eSIM Satin Alma Hatasi - DataPatch', adminHtml, { type: 'admin_alert' });
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

export default {
  sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail,
  sendEsimAssignedEmail, sendPaymentSuccessEmail, sendPaymentFailedEmail,
  sendEsimActivationFailedEmail, sendReplyEmail
};
