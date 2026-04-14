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
        const { sendMail } = await import('../services/emailService.js');
        await sendMail(booking.travelerEmail, 'eSIM kurulum suren tukeniyor!',
          `<p>Merhaba ${booking.travelerName},</p>
           <p>eSIM'ini kurman icin <strong>5 gun</strong> kaldi. Su linkten kurabilirsin:</p>
           <p><a href="${process.env.APP_URL || 'https://datapatch.app'}/e/${booking.token}">eSIM'i Kur</a></p>
           <p>30 gun icinde kurulmayan eSIM'ler gecersiz olur.</p>`,
          { type: 'expiry_reminder', userId: null }
        );
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
