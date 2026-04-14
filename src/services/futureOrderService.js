import * as airalo from './airaloClient.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'futureOrder' });

const WEBHOOK_URL = process.env.APP_URL
  ? `${process.env.APP_URL}/api/webhooks/airalo`
  : 'https://datapatch.app/api/webhooks/airalo';

export async function submitFutureOrder({ packageId, dueDate, agencySlug, bookingId }) {
  const dueDateStr = formatDueDateUTC(dueDate);
  const description = `DataPatch-${agencySlug}-${bookingId}`;

  const result = await airalo.createFutureOrder({
    packageId,
    dueDate: dueDateStr,
    webhookUrl: WEBHOOK_URL,
    description
  });

  const requestId = result?.data?.request_id || result?.data?.id;
  if (!requestId) {
    throw new Error('Airalo createFutureOrder returned no request_id');
  }

  log.info({ packageId, dueDate: dueDateStr, requestId, bookingId }, 'Future order submitted');
  return requestId;
}

export async function cancelOrder(requestId) {
  await airalo.cancelFutureOrder(requestId);
  log.info({ requestId }, 'Future order cancelled');
}

export async function pollOrderStatus(requestId) {
  const result = await airalo.getFutureOrder(requestId);
  return result?.data;
}

function formatDueDateUTC(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
