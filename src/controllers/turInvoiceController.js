import crypto from 'crypto';
import * as turInvoice from '../services/turInvoiceClient.js';
import { handleTurInvoiceCallback } from '../services/paymentService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'turInvoice-controller' });

export async function handleCallback(req, res) {
  const payload = req.body;

  const expectedSecret = process.env.TURINVOICE_CALLBACK_SECRET;
  if (!expectedSecret) {
    log.error('TURINVOICE_CALLBACK_SECRET not configured — rejecting callback');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  if (!payload.secret_key) {
    log.warn({ id: payload.id }, 'TurInvoice callback: missing secret_key');
    return res.status(401).json({ error: 'Missing secret_key' });
  }
  const expected = Buffer.from(expectedSecret);
  const received = Buffer.from(String(payload.secret_key));
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    log.warn({ id: payload.id }, 'TurInvoice callback: invalid secret_key');
    return res.status(401).json({ error: 'Invalid secret_key' });
  }

  log.info({ id: payload.id, state: payload.state }, 'TurInvoice callback received');
  res.json({ received: true });

  try {
    await handleTurInvoiceCallback(payload);
  } catch (err) {
    log.error({ err, id: payload.id }, 'TurInvoice callback processing failed');
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
