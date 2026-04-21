import crypto from 'crypto';
import * as turInvoice from '../services/turInvoiceClient.js';
import { handleTurInvoiceCallback } from '../services/paymentService.js';
import { logPaymentWebhook } from '../services/webhookLogger.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'turInvoice-controller' });

function sanitizeTurInvoicePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const { secret_key, ...rest } = payload;
  return rest;
}

export async function handleCallback(req, res) {
  const payload = req.body;
  const idOrder = payload?.id;
  const eventType = payload?.state || null;
  const safePayload = sanitizeTurInvoicePayload(payload);

  const expectedSecret = process.env.TURINVOICE_CALLBACK_SECRET;
  if (!expectedSecret) {
    log.error('TURINVOICE_CALLBACK_SECRET not configured — rejecting callback');
    await logPaymentWebhook({ provider: 'turinvoice', eventType, signatureValid: null, processed: false, error: 'server_misconfigured', providerTransactionId: idOrder, payload: safePayload });
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  if (!payload.secret_key) {
    log.warn({ id: idOrder }, 'TurInvoice callback: missing secret_key');
    await logPaymentWebhook({ provider: 'turinvoice', eventType, signatureValid: false, processed: false, error: 'missing_secret', providerTransactionId: idOrder, payload: safePayload });
    return res.status(401).json({ error: 'Missing secret_key' });
  }
  const expected = Buffer.from(expectedSecret);
  const received = Buffer.from(String(payload.secret_key));
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    log.warn({ id: idOrder }, 'TurInvoice callback: invalid secret_key');
    await logPaymentWebhook({ provider: 'turinvoice', eventType, signatureValid: false, processed: false, error: 'invalid_secret', providerTransactionId: idOrder, payload: safePayload });
    return res.status(401).json({ error: 'Invalid secret_key' });
  }

  log.info({ id: idOrder, state: payload.state }, 'TurInvoice callback received');
  res.json({ received: true });

  let processed = false;
  let errorMsg = null;
  try {
    await handleTurInvoiceCallback(payload);
    processed = true;
  } catch (err) {
    errorMsg = err.message;
    log.error({ err, id: idOrder }, 'TurInvoice callback processing failed');
  } finally {
    await logPaymentWebhook({ provider: 'turinvoice', eventType, signatureValid: true, processed, error: errorMsg, providerTransactionId: idOrder, payload: safePayload });
  }
}

export async function serveQrCode(req, res) {
  const { idOrder } = req.params;

  try {
    const { data, contentType } = await turInvoice.getQrCode(Number(idOrder));
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(data));
  } catch (err) {
    log.error({ err, idOrder }, 'Failed to fetch TurInvoice QR code');
    res.status(502).json({ error: 'QR code unavailable' });
  }
}
