import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:stale-payments' });

// Cancel payments that have been pending longer than this (in hours)
const STALE_HOURS = parseInt(process.env.STALE_PAYMENT_HOURS || '2', 10);

export async function run() {
  const { Op } = db.Sequelize;
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

  const stalePayments = await db.Payment.findAll({
    where: {
      status: 'pending',
      createdAt: { [Op.lt]: cutoff }
    }
  });

  if (stalePayments.length === 0) return;

  log.info({ count: stalePayments.length, cutoffHours: STALE_HOURS }, 'Found stale pending payments');

  for (const payment of stalePayments) {
    try {
      // Try to cancel in the payment provider
      await cancelInProvider(payment);

      await payment.update({
        status: 'cancelled',
        metadata: {
          ...payment.metadata,
          cancelledAt: new Date().toISOString(),
          cancelReason: 'auto_stale',
          staleCutoffHours: STALE_HOURS
        }
      });

      log.info({
        paymentId: payment.id,
        merchantOid: payment.merchantOid,
        provider: payment.provider,
        ageHours: Math.round((Date.now() - new Date(payment.createdAt).getTime()) / 3600000)
      }, 'Stale payment cancelled');
    } catch (err) {
      log.error({ err, paymentId: payment.id, merchantOid: payment.merchantOid }, 'Failed to cancel stale payment');
    }
  }
}

async function cancelInProvider(payment) {
  const provider = payment.provider;
  const txId = payment.providerTransactionId;

  if (!txId) {
    log.debug({ paymentId: payment.id }, 'No provider transaction ID, skipping provider cancel');
    return;
  }

  if (provider === 'paddle') {
    await cancelPaddleTransaction(txId, payment);
  } else if (provider === 'turinvoice') {
    await cancelTurInvoiceOrder(payment);
  } else {
    log.debug({ paymentId: payment.id, provider }, 'Unknown provider, local cancel only');
  }
}

async function cancelPaddleTransaction(transactionId, payment) {
  try {
    const environment = process.env.PADDLE_ENVIRONMENT || 'sandbox';
    const apiBase = environment === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
    const apiKey = process.env.PADDLE_API_KEY;

    if (!apiKey) {
      log.warn({ paymentId: payment.id }, 'No Paddle API key, skipping Paddle cancel');
      return;
    }

    // Paddle: GET transaction to check if it's still open/draft, then cancel if possible
    const response = await fetch(`${apiBase}/transactions/${transactionId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      log.warn({ paymentId: payment.id, transactionId, status: response.status }, 'Paddle transaction fetch failed');
      return;
    }

    const data = await response.json();
    const txStatus = data.data?.status;

    // Only cancel if transaction is still in a cancellable state
    if (txStatus === 'draft' || txStatus === 'ready' || txStatus === 'billed') {
      // Paddle doesn't have a direct cancel endpoint for one-time transactions
      // but we can mark it as canceled locally. If it's 'billed', the user already paid.
      if (txStatus === 'billed') {
        log.warn({ paymentId: payment.id, transactionId }, 'Paddle transaction is billed — skipping cancel, needs manual review');
        return;
      }

      log.info({ paymentId: payment.id, transactionId, paddleStatus: txStatus }, 'Paddle transaction in cancellable state, marking cancelled locally');
    } else if (txStatus === 'completed' || txStatus === 'canceled') {
      log.info({ paymentId: payment.id, transactionId, paddleStatus: txStatus }, 'Paddle transaction already finalized');
    } else {
      log.info({ paymentId: payment.id, transactionId, paddleStatus: txStatus }, 'Paddle transaction status noted');
    }
  } catch (err) {
    log.error({ err, paymentId: payment.id, transactionId }, 'Paddle cancel check failed');
  }
}

async function cancelTurInvoiceOrder(payment) {
  try {
    const idOrder = payment.metadata?.turInvoiceIdOrder;
    if (!idOrder) {
      log.debug({ paymentId: payment.id }, 'No TurInvoice order ID, skipping');
      return;
    }

    const { getOrder } = await import('../services/turInvoiceClient.js');
    const order = await getOrder(idOrder);
    const orderState = order?.state || order?.status;

    if (orderState === 'created' || orderState === 'pending') {
      log.info({ paymentId: payment.id, idOrder, orderState }, 'TurInvoice order still pending, marking cancelled locally');
    } else if (orderState === 'paid' || orderState === 'completed') {
      log.warn({ paymentId: payment.id, idOrder, orderState }, 'TurInvoice order already paid — skipping cancel, needs manual review');
      // Don't cancel locally if it's paid
      throw new Error(`TurInvoice order ${idOrder} is already paid, manual review needed`);
    } else {
      log.info({ paymentId: payment.id, idOrder, orderState }, 'TurInvoice order state noted');
    }
  } catch (err) {
    if (err.message?.includes('manual review')) throw err;
    log.error({ err, paymentId: payment.id }, 'TurInvoice cancel check failed');
  }
}
