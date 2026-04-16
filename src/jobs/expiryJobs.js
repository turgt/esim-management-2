import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:expiry' });

export async function runReminder() {
  const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const expiringSoon = await db.TravelerBooking.findAll({
    where: {
      status: 'provisioned',
      provisionedAt: { [db.Sequelize.Op.between]: [thirtyDaysAgo, twentyFiveDaysAgo] }
    },
    include: [{ model: db.Agency }]
  });
  if (expiringSoon.length === 0) return;
  log.info({ count: expiringSoon.length }, 'Sending expiry reminders');
  for (const booking of expiringSoon) {
    if (booking.travelerEmail) {
      try {
        const { sendMail, emailLayout, emailButton } = await import('../services/emailService.js');
        const appUrl = process.env.APP_URL || 'https://datapatch.app';
        const html = emailLayout(`
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Kurulum Suren Dolmak Uzere!</h2>
          <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${booking.travelerName},</p>
          <p style="color:#475569;font-size:15px;line-height:1.6;">eSIM'ini kurman icin <strong>5 gun</strong> kaldi. Asagidaki butondan hemen kurabilirsin:</p>
          ${emailButton(`${appUrl}/e/${booking.token}`, 'eSIM\'i Kur')}
          <p style="color:#94a3b8;font-size:13px;">30 gun icinde kurulmayan eSIM'ler gecersiz olur.</p>
        `, { preheader: 'eSIM kurulumu icin 5 gun kaldi' });
        await sendMail(booking.travelerEmail, 'eSIM Kurulum Hatirlatmasi - DataPatch', html, { type: 'expiry_reminder', userId: null });
      } catch (err) {
        log.error({ err, bookingId: booking.id }, 'Expiry reminder email failed');
      }
    }
  }
}

export async function runMarker() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [count] = await db.TravelerBooking.update(
    { status: 'expired' },
    { where: { status: 'provisioned', provisionedAt: { [db.Sequelize.Op.lt]: thirtyDaysAgo } } }
  );
  if (count > 0) log.info({ count }, 'Marked expired bookings');
}
