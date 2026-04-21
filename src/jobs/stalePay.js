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
      const providerStatus = await checkProviderStatus(payment);

      if (providerStatus === 'paid') {
        // Provider says paid but we missed it — trigger completion flow
        log.warn({ paymentId: payment.id, merchantOid: payment.merchantOid, provider: payment.provider },
          'Provider shows PAID but local status is pending — triggering completion');
        await reconcileAsPaid(payment);
      } else if (providerStatus === 'skip') {
        // Provider in ambiguous state, skip this cycle
        log.info({ paymentId: payment.id }, 'Provider in ambiguous state, skipping');
      } else {
        // Provider says not paid (expired/pending/failed/unknown) — safe to cancel locally
        const effectiveProvider = resolveProvider(payment);
        await payment.update({
          status: 'cancelled',
          provider: effectiveProvider,
          metadata: {
            ...payment.metadata,
            cancelledAt: new Date().toISOString(),
            cancelReason: 'auto_stale',
            providerStatus,
            staleCutoffHours: STALE_HOURS
          }
        });

        log.info({
          paymentId: payment.id,
          merchantOid: payment.merchantOid,
          provider: payment.provider,
          providerStatus,
          ageHours: Math.round((Date.now() - new Date(payment.createdAt).getTime()) / 3600000)
        }, 'Stale payment cancelled');
      }
    } catch (err) {
      log.error({ err, paymentId: payment.id, merchantOid: payment.merchantOid }, 'Failed to process stale payment');
    }
  }
}

// Returns: 'paid' | 'unpaid' | 'skip' | 'no_provider'
async function checkProviderStatus(payment) {
  const effectiveProvider = resolveProvider(payment);
  const txId = payment.providerTransactionId;

  if (!effectiveProvider || effectiveProvider === 'pending') return 'no_provider';
  if (!txId) return 'no_provider';

  if (effectiveProvider === 'paddle') {
    return checkPaddleStatus(txId, payment);
  } else if (effectiveProvider === 'turinvoice') {
    return checkTurInvoiceStatus(payment);
  }

  return 'no_provider';
}

// Resolve the real provider by cross-checking metadata signals.
// Historical bug: some TurInvoice orders were saved with provider='paddle'
// because createPayment hardcoded 'paddle' and the old createTurInvoiceCheckout
// did not update the column. Use metadata.turInvoiceIdOrder as the source of
// truth when present.
function resolveProvider(payment) {
  if (payment.metadata?.turInvoiceIdOrder) return 'turinvoice';
  if (payment.metadata?.provider === 'turinvoice') return 'turinvoice';
  return payment.provider;
}

async function checkPaddleStatus(transactionId, payment) {
  try {
    const environment = process.env.PADDLE_ENVIRONMENT || 'sandbox';
    const apiBase = environment === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
    const apiKey = process.env.PADDLE_API_KEY;

    if (!apiKey) {
      log.debug({ paymentId: payment.id }, 'No Paddle API key, cannot check');
      return 'no_provider';
    }

    const response = await fetch(`${apiBase}/transactions/${transactionId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      log.warn({ paymentId: payment.id, transactionId, httpStatus: response.status }, 'Paddle status check failed');
      return 'skip';
    }

    const data = await response.json();
    const txStatus = data.data?.status;

    log.info({ paymentId: payment.id, transactionId, paddleStatus: txStatus }, 'Paddle status checked');

    // Paddle statuses: draft, ready, billed, paid, completed, canceled, past_due
    if (txStatus === 'completed' || txStatus === 'paid') {
      return 'paid';
    } else if (txStatus === 'billed') {
      // Billed = customer charged but not yet completed
      // Cancel on Paddle side via PATCH API
      await cancelPaddleTransaction(apiBase, apiKey, transactionId, payment);
      return 'unpaid';
    } else if (txStatus === 'canceled' || txStatus === 'past_due') {
      return 'unpaid';
    } else if (txStatus === 'draft' || txStatus === 'ready') {
      // Not yet paid, expires naturally on Paddle's side
      return 'unpaid';
    }

    return 'unpaid';
  } catch (err) {
    log.error({ err, paymentId: payment.id }, 'Paddle status check exception');
    return 'skip';
  }
}

// PATCH /transactions/:id with {"status":"canceled"} — works for billed transactions
async function cancelPaddleTransaction(apiBase, apiKey, transactionId, payment) {
  try {
    const response = await fetch(`${apiBase}/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'canceled' })
    });

    if (response.ok) {
      log.info({ paymentId: payment.id, transactionId }, 'Paddle transaction canceled via API');
    } else {
      const errData = await response.json().catch(() => ({}));
      log.warn({ paymentId: payment.id, transactionId, httpStatus: response.status, error: errData },
        'Paddle cancel API failed — will cancel locally only');
    }
  } catch (err) {
    log.error({ err, paymentId: payment.id, transactionId }, 'Paddle cancel API exception');
  }
}

async function checkTurInvoiceStatus(payment) {
  try {
    const idOrder = payment.metadata?.turInvoiceIdOrder;
    if (!idOrder) {
      log.debug({ paymentId: payment.id }, 'No TurInvoice order ID');
      return 'no_provider';
    }

    const { getOrder, cancelOrder, isInitialized } = await import('../services/turInvoiceClient.js');
    if (!isInitialized()) {
      log.debug({ paymentId: payment.id }, 'TurInvoice not initialized');
      return 'skip';
    }

    const order = await getOrder(idOrder);
    const orderState = order?.state || order?.status;

    log.info({ paymentId: payment.id, idOrder, turInvoiceState: orderState }, 'TurInvoice status checked');

    if (orderState === 'paid' || orderState === 'completed') {
      return 'paid';
    }

    const isTerminal = orderState === 'failed' || orderState === 'cancelled' || orderState === 'expired' || orderState === 'deleted';
    if (!isTerminal) {
      // Any non-terminal, non-paid state ('new', 'created', 'pending', unknown) —
      // cancel on TurInvoice via DELETE API so the customer can't pay a stale order.
      try {
        await cancelOrder(idOrder);
        log.info({ paymentId: payment.id, idOrder, orderState }, 'TurInvoice order cancelled via API');
      } catch (cancelErr) {
        log.warn({ err: cancelErr, paymentId: payment.id, idOrder, orderState }, 'TurInvoice cancel API failed — will cancel locally only');
      }
    }
    return 'unpaid';
  } catch (err) {
    log.error({ err, paymentId: payment.id }, 'TurInvoice status check exception');
    return 'skip';
  }
}

// When provider says paid but we missed the webhook
async function reconcileAsPaid(payment) {
  try {
    const { processPaddleWebhook } = await import('../services/paymentService.js');

    // Mark as completed — the webhook handler will take care of eSIM purchase
    const effectiveProvider = resolveProvider(payment);
    await payment.update({
      status: 'completed',
      provider: effectiveProvider,
      metadata: {
        ...payment.metadata,
        reconciledAt: new Date().toISOString(),
        reconcileReason: 'stale_job_provider_paid'
      }
    });

    log.info({ paymentId: payment.id, merchantOid: payment.merchantOid }, 'Stale payment reconciled as completed');

    // Try to trigger eSIM purchase if not already done
    if (!payment.esimId) {
      try {
        let purchaseFn;
        if (payment.type === 'topup' && payment.targetIccid) {
          ({ topupEsimAfterPayment: purchaseFn } = await import('../services/paymentService.js'));
        } else {
          ({ purchaseEsimAfterPayment: purchaseFn } = await import('../services/paymentService.js'));
        }
        await purchaseFn(payment);
        log.info({ paymentId: payment.id }, 'eSIM purchase triggered after reconciliation');
      } catch (purchaseErr) {
        log.error({ err: purchaseErr, paymentId: payment.id }, 'eSIM purchase failed after reconciliation');
        await payment.update({
          metadata: {
            ...payment.metadata,
            esimPurchaseFailed: true,
            esimPurchaseError: purchaseErr.message
          }
        });
      }
    }
  } catch (err) {
    log.error({ err, paymentId: payment.id }, 'Reconciliation failed');
  }
}
