import db from '../db/models/index.js';
import { processWebhook } from '../controllers/webhookController.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:webhook-retry' });
const MAX_RETRIES = 3;

export async function run() {
  const failedLogs = await db.AiraloWebhookLog.findAll({
    where: { processStatus: 'failed', retryCount: { [db.Sequelize.Op.lt]: MAX_RETRIES } },
    order: [['receivedAt', 'ASC']], limit: 20
  });
  if (failedLogs.length === 0) return;
  log.info({ count: failedLogs.length }, 'Retrying failed webhooks');
  for (const webhookLog of failedLogs) {
    try {
      await webhookLog.update({ processStatus: 'retrying', retryCount: webhookLog.retryCount + 1 });
      await processWebhook(webhookLog);
      log.info({ id: webhookLog.id }, 'Webhook retry succeeded');
    } catch (err) {
      log.error({ err, id: webhookLog.id }, 'Webhook retry failed');
      await webhookLog.update({ processStatus: 'failed', error: err.message }).catch(() => {});
    }
  }
}
