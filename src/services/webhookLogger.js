import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'webhook-logger' });

export async function logPaymentWebhook({ provider, eventType, signatureValid, processed, error, merchantOid, providerTransactionId, payload }) {
  try {
    await db.PaymentWebhookLog.create({
      provider,
      eventType: eventType || null,
      signatureValid: signatureValid ?? null,
      processed: processed ?? false,
      error: error || null,
      merchantOid: merchantOid || null,
      providerTransactionId: providerTransactionId ? String(providerTransactionId) : null,
      payload: payload || null
    });
  } catch (err) {
    log.error({ err, provider, eventType }, 'Failed to persist payment webhook log');
  }
}
