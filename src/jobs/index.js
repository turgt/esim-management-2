import cron from 'node-cron';
import logger from '../lib/logger.js';
import { run as webhookRetry } from './webhookRetry.js';
import { run as provisionWatchdog } from './provisionWatchdog.js';
import { runReminder, runMarker } from './expiryJobs.js';
import { run as cancelStalePayments } from './stalePay.js';

const log = logger.child({ module: 'jobs' });

export function startJobs() {
  log.info('Starting background jobs');
  cron.schedule('*/10 * * * *', async () => {
    try { await webhookRetry(); } catch (err) { log.error({ err }, 'webhookRetry job error'); }
  });
  cron.schedule('0 * * * *', async () => {
    try { await provisionWatchdog(); } catch (err) { log.error({ err }, 'provisionWatchdog job error'); }
  });
  cron.schedule('0 9 * * *', async () => {
    try { await runReminder(); } catch (err) { log.error({ err }, 'expiryReminder job error'); }
  });
  cron.schedule('30 0 * * *', async () => {
    try { await runMarker(); } catch (err) { log.error({ err }, 'expiryMarker job error'); }
  });
  // Cancel stale pending payments every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try { await cancelStalePayments(); } catch (err) { log.error({ err }, 'cancelStalePayments job error'); }
  });
  log.info('Background jobs scheduled');
}
