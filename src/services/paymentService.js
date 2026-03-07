import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'payment' });

export async function createPayment(userId, amount, currency = 'TRY', metadata = {}) {
  const payment = await db.Payment.create({
    userId,
    amount,
    currency,
    status: 'pending',
    provider: null,
    metadata
  });

  log.info({ paymentId: payment.id, amount, currency }, 'Payment created (placeholder)');
  return payment;
}

export async function verifyPayment(paymentId) {
  const payment = await db.Payment.findByPk(paymentId);
  if (!payment) return null;

  log.info({ paymentId }, 'Payment verification requested (placeholder)');
  return payment;
}

export async function refundPayment(paymentId) {
  const payment = await db.Payment.findByPk(paymentId);
  if (!payment) return null;

  await payment.update({ status: 'refunded' });
  log.info({ paymentId }, 'Payment refund processed (placeholder)');
  return payment;
}

export default { createPayment, verifyPayment, refundPayment };
