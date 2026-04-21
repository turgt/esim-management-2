import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:webhook-health' });

const SILENCE_HOURS = parseInt(process.env.WEBHOOK_SILENCE_WARN_HOURS || '6', 10);

const PROVIDERS = ['paddle', 'turinvoice'];

export async function run() {
  const { Op } = db.Sequelize;
  const silenceCutoff = new Date(Date.now() - SILENCE_HOURS * 60 * 60 * 1000);

  for (const provider of PROVIDERS) {
    const pendingCount = await db.Payment.count({
      where: {
        provider,
        status: 'pending',
        createdAt: { [Op.lt]: silenceCutoff }
      }
    });

    if (pendingCount === 0) continue;

    const lastWebhook = await db.PaymentWebhookLog.findOne({
      where: { provider },
      order: [['createdAt', 'DESC']]
    });

    const lastAt = lastWebhook?.createdAt || null;
    const isSilent = !lastAt || new Date(lastAt) < silenceCutoff;

    if (isSilent) {
      log.warn({
        provider,
        pendingCount,
        silenceHours: SILENCE_HOURS,
        lastWebhookAt: lastAt ? new Date(lastAt).toISOString() : null
      }, 'Webhook silence detected — no recent webhooks despite pending payments');
    } else {
      log.info({
        provider,
        pendingCount,
        lastWebhookAt: new Date(lastAt).toISOString()
      }, 'Webhook health OK');
    }
  }
}
