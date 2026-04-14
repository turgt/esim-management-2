import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/models/index.js';
import { purchaseEsim as zenditPurchaseEsim, normalizeStatus, getBalance as getZenditBalance } from './zenditClient.js';
import { createOrder as airaloCreateOrder, checkBalance as checkAiraloBalance, createTopup as airaloCreateTopup } from './airaloClient.js';
import { logAudit, ACTIONS } from './auditService.js';
import { sendPaymentSuccessEmail, sendPaymentFailedEmail, sendEsimActivationFailedEmail } from './emailService.js';
import logger from '../lib/logger.js';
import * as turInvoice from './turInvoiceClient.js';

const log = logger.child({ module: 'payment' });

function getPaddleConfig() {
  const environment = process.env.PADDLE_ENVIRONMENT || 'sandbox';
  return {
    apiKey: process.env.PADDLE_API_KEY || '',
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || '',
    environment,
    apiBase: environment === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com'
  };
}

export async function checkProviderBalance(amount) {
  return checkAiraloBalance(amount);
}

export { checkProviderBalance as checkZenditBalance };

export async function createPayment(userId, offerId, amount, currency = 'USD', metadata = {}, opts = {}) {
  const merchantOid = `ESIM_${Date.now()}_${uuidv4().slice(0, 8)}`;

  const payment = await db.Payment.create({
    userId,
    offerId,
    amount,
    currency,
    status: 'pending',
    provider: 'paddle',
    merchantOid,
    type: opts.type || 'purchase',
    targetIccid: opts.targetIccid || null,
    metadata
  });

  log.info({ paymentId: payment.id, merchantOid, amount, currency, offerId, type: payment.type }, 'Payment created');

  await logAudit(ACTIONS.PAYMENT_CREATED, {
    userId,
    entity: 'Payment',
    entityId: payment.id,
    details: { merchantOid, offerId, amount, currency, type: payment.type }
  });

  return payment;
}

export async function createPaddleCheckout({ payment, user }) {
  const config = getPaddleConfig();

  if (!config.apiKey) {
    throw new Error('Paddle API key not configured');
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const amountCents = Math.round(payment.amount * 100).toString();
  const label = payment.type === 'topup'
    ? `Data Top-up - ${payment.offerId}`
    : `Data Plan - ${payment.offerId}`;

  const productId = process.env.PADDLE_PRODUCT_ID || '';
  if (!productId) {
    throw new Error('PADDLE_PRODUCT_ID not configured');
  }

  const body = {
    items: [{
      quantity: 1,
      price: {
        description: label,
        product_id: productId,
        unit_price: {
          amount: amountCents,
          currency_code: payment.currency || 'USD'
        },
        tax_mode: 'account_setting'
      }
    }],
    customer: {
      email: user.email || `${user.username}@datapatch.net`
    },
    custom_data: {
      merchantOid: payment.merchantOid
    },
    checkout: {
      url: `${appUrl}/payment/result/${payment.merchantOid}`
    }
  };

  log.info({ merchantOid: payment.merchantOid, body }, 'Paddle transaction request');

  const response = await fetch(`${config.apiBase}/transactions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    log.error({ merchantOid: payment.merchantOid, status: response.status, paddleResponse: data }, 'Paddle checkout creation failed');
    throw new Error(`Paddle checkout error: ${data.error?.detail || JSON.stringify(data) || 'Unknown error'}`);
  }

  log.info({ merchantOid: payment.merchantOid, transactionId: data.data.id }, 'Paddle checkout created');
  return {
    checkoutUrl: data.data.checkout.url,
    paddleTransactionId: data.data.id
  };
}

export async function createTurInvoiceCheckout({ payment, paymentType }) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const callbackUrl = `${appUrl}/payment/turinvoice/callback`;
  const redirectUrl = `${appUrl}/payment/result/${payment.merchantOid}`;

  const orderResult = await turInvoice.createOrder({
    amount: Number(payment.amount),
    currency: payment.currency || 'USD',
    name: `eSIM ${payment.merchantOid}`,
    callbackUrl,
    redirectUrl
  });

  const idOrder = orderResult.idOrder;
  if (!idOrder) {
    throw new Error('TurInvoice createOrder returned no idOrder');
  }

  const orderDetails = await turInvoice.getOrder(idOrder);

  await payment.update({
    providerTransactionId: String(idOrder),
    metadata: {
      ...payment.metadata,
      turInvoiceIdOrder: idOrder,
      paymentUrl: orderDetails.paymentUrl,
      paymentType,
      turInvoiceState: orderDetails.state
    }
  });

  return {
    idOrder,
    paymentUrl: orderDetails.paymentUrl,
    merchantOid: payment.merchantOid
  };
}

export async function handleTurInvoiceCallback(payload) {
  const cbLog = logger.child({ module: 'turInvoice-callback' });

  const idOrder = payload.id;
  if (!idOrder) {
    cbLog.warn({ payload }, 'TurInvoice callback missing id');
    return;
  }

  const payment = await db.Payment.findOne({
    where: { provider: 'turinvoice', providerTransactionId: String(idOrder) }
  });

  if (!payment) {
    cbLog.warn({ idOrder }, 'TurInvoice callback: no matching payment');
    return;
  }

  if (payment.status === 'completed') {
    cbLog.info({ idOrder, merchantOid: payment.merchantOid }, 'TurInvoice callback: already completed, skipping');
    return;
  }

  if (payload.state === 'paid') {
    cbLog.info({ idOrder, merchantOid: payment.merchantOid }, 'TurInvoice payment confirmed');

    await payment.update({
      status: 'completed',
      metadata: {
        ...payment.metadata,
        turInvoiceState: 'paid',
        datePay: payload.datePay,
        linkReceipt: payload.linkReceipt
      }
    });

    try {
      await purchaseEsimAfterPayment(payment);
      await sendPaymentSuccessEmail(payment);
    } catch (err) {
      cbLog.error({ err, merchantOid: payment.merchantOid }, 'eSIM purchase after TurInvoice payment failed');
      await payment.update({
        metadata: { ...payment.metadata, esimPurchaseFailed: true, esimError: err.message }
      });
      await sendEsimActivationFailedEmail(payment);
    }
  } else if (payload.state === 'failed' || payload.state === 'cancelled') {
    cbLog.warn({ idOrder, state: payload.state }, 'TurInvoice payment failed/cancelled');
    await payment.update({
      status: 'failed',
      metadata: { ...payment.metadata, turInvoiceState: payload.state }
    });
    await sendPaymentFailedEmail(payment);
  }
}

export async function getTurInvoiceStatus(payment) {
  if (!payment.providerTransactionId) return null;

  const idOrder = Number(payment.providerTransactionId);
  const orderDetails = await turInvoice.getOrder(idOrder);

  const createdAt = new Date(payment.createdAt);
  const now = new Date();
  const minutesElapsed = (now - createdAt) / 60000;

  if (orderDetails.state === 'new' && minutesElapsed > 30) {
    await payment.update({
      status: 'failed',
      metadata: { ...payment.metadata, turInvoiceState: 'timeout', reason: 'timeout' }
    });
    return 'failed';
  }

  if (orderDetails.state === 'paid' && payment.status !== 'completed') {
    await handleTurInvoiceCallback({ ...orderDetails, id: idOrder, state: 'paid' });
    return 'completed';
  }

  if (orderDetails.state !== payment.metadata?.turInvoiceState) {
    await payment.update({
      metadata: { ...payment.metadata, turInvoiceState: orderDetails.state }
    });
  }

  return orderDetails.state === 'paid' ? 'completed' : 'pending';
}

export function verifyPaddleWebhook(rawBody, signatureHeader) {
  const config = getPaddleConfig();
  if (!config.webhookSecret || !signatureHeader) return false;

  // Paddle-Signature format: ts=TIMESTAMP;h1=HMAC_SHA256_HEX
  const parts = signatureHeader.split(';');
  const tsPart = parts.find(p => p.startsWith('ts='));
  const h1Part = parts.find(p => p.startsWith('h1='));
  if (!tsPart || !h1Part) return false;

  const ts = tsPart.slice(3);
  const h1 = h1Part.slice(3);

  const signedPayload = `${ts}:${rawBody}`;
  const expectedHash = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(signedPayload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(h1, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}

async function sendEmailNotification(payment, esim) {
  try {
    const user = await db.User.findByPk(payment.userId);
    if (!user || !user.email) return;

    if (payment.status === 'completed' && payment.metadata?.esimPurchaseFailed) {
      await sendEsimActivationFailedEmail(user, payment);
    } else if (payment.status === 'completed') {
      await sendPaymentSuccessEmail(user, payment, esim);
    } else if (payment.status === 'failed') {
      await sendPaymentFailedEmail(user, payment);
    }
  } catch (err) {
    log.error({ err, merchantOid: payment.merchantOid }, 'Failed to send payment email notification');
  }
}

export async function processPaddleWebhook(body) {
  const { event_type, data } = body;

  const merchantOid = data?.custom_data?.merchantOid;
  if (!merchantOid) {
    log.warn({ event_type }, 'Paddle webhook missing merchantOid in custom_data');
    return null;
  }

  const payment = await findByMerchantOid(merchantOid);
  if (!payment) {
    log.warn({ merchantOid }, 'Webhook for unknown payment');
    return null;
  }

  // Idempotent: skip if already processed
  if (payment.status !== 'pending') {
    log.info({ merchantOid, existingStatus: payment.status }, 'Payment already processed, skipping');
    return payment;
  }

  if (event_type === 'transaction.completed') {
    await payment.update({
      status: 'completed',
      providerTransactionId: data.id,
      metadata: { ...payment.metadata, paddleCallback: { event_type, transactionId: data.id } }
    });

    log.info({ merchantOid, paymentId: payment.id }, 'Payment completed via Paddle');

    await logAudit(ACTIONS.PAYMENT_SUCCESS, {
      userId: payment.userId,
      entity: 'Payment',
      entityId: payment.id,
      details: { merchantOid, transactionId: data.id }
    });

    let esim = null;
    try {
      if (payment.type === 'topup' && payment.targetIccid) {
        esim = await topupEsimAfterPayment(payment);
      } else {
        esim = await purchaseEsimAfterPayment(payment);
      }
      await sendEmailNotification(payment, esim);
    } catch (err) {
      log.error({ err, merchantOid }, 'eSIM purchase failed after successful payment');
      await payment.update({
        metadata: {
          ...payment.metadata,
          esimPurchaseError: err.message,
          esimPurchaseFailed: true
        }
      });
      await sendEmailNotification(payment, null);
    }
  } else if (event_type === 'transaction.payment_failed') {
    await payment.update({
      status: 'failed',
      metadata: { ...payment.metadata, paddleCallback: { event_type, transactionId: data.id } }
    });

    log.info({ merchantOid, paymentId: payment.id }, 'Payment failed via Paddle');

    await logAudit(ACTIONS.PAYMENT_FAILED, {
      userId: payment.userId,
      entity: 'Payment',
      entityId: payment.id,
      details: { merchantOid, event_type }
    });

    await sendEmailNotification(payment, null);
  } else {
    log.info({ event_type, merchantOid }, 'Unhandled Paddle webhook event, ignoring');
  }

  return payment;
}

export async function purchaseEsimAfterPayment(payment) {
  // Check if this is a legacy Zendit payment
  if (payment.metadata?.vendor === 'zendit') {
    return zenditPurchaseEsimAfterPayment(payment);
  }

  const balanceCheck = await checkAiraloBalance(parseFloat(payment.amount));
  if (!balanceCheck.sufficient) {
    const msg = `Insufficient Airalo balance: available $${balanceCheck.available}, required $${balanceCheck.required}`;
    log.error({ merchantOid: payment.merchantOid, ...balanceCheck }, msg);
    throw new Error(msg);
  }

  log.info({ merchantOid: payment.merchantOid, packageId: payment.offerId }, 'Purchasing Airalo eSIM after payment');

  const orderResult = await airaloCreateOrder(payment.offerId, 1, `Payment ${payment.merchantOid}`);
  const order = orderResult?.data || orderResult;
  const sim = order.sims?.[0] || {};

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId: String(order.id || order.code),
    status: 'completed',
    vendor: 'airalo',
    vendorOrderId: String(order.id),
    iccid: sim.iccid || null,
    country: null,
    dataGB: order.data ? parseFloat(order.data) || null : null,
    durationDays: order.validity || null,
    brandName: order.package || null,
    priceAmount: order.price || null,
    priceCurrency: order.currency || 'USD',
    vendorData: {
      lpa: sim.lpa || null,
      matchingId: sim.matching_id || null,
      qrcodeUrl: sim.qrcode_url || null,
      qrcode: sim.qrcode || null,
      directAppleUrl: sim.direct_apple_installation_url || null,
      apn: sim.apn || null,
      msisdn: sim.msisdn || null,
      manualInstallation: order.manual_installation || null,
      qrcodeInstallation: order.qrcode_installation || null,
    }
  });

  await payment.update({
    esimId: esim.id,
    metadata: { ...payment.metadata, esimTransactionId: String(order.id), esimId: esim.id }
  });

  await logAudit(ACTIONS.ESIM_PURCHASE, {
    userId: payment.userId,
    entity: 'Esim',
    entityId: esim.id,
    details: { offerId: payment.offerId, airaloOrderId: order.id, merchantOid: payment.merchantOid }
  });

  log.info({ merchantOid: payment.merchantOid, airaloOrderId: order.id, esimId: esim.id }, 'Airalo eSIM purchased after payment');
  return esim;
}

async function zenditPurchaseEsimAfterPayment(payment) {
  const balance = await getZenditBalance();
  const availableUsd = balance.availableBalance / (balance.currencyDivisor || 100);
  if (availableUsd < parseFloat(payment.amount)) {
    throw new Error(`Insufficient Zendit balance: $${availableUsd.toFixed(2)}`);
  }

  const transactionId = uuidv4();
  const purchase = await zenditPurchaseEsim(payment.offerId, transactionId);
  const confirmation = purchase.confirmation || {};

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId,
    status: normalizeStatus(purchase.status),
    vendor: 'zendit',
    iccid: confirmation.iccid || null,
    smdpAddress: confirmation.smdpAddress || null,
    activationCode: confirmation.externalReferenceId || confirmation.activationCode || null,
    country: purchase.country || process.env.COUNTRY || 'TR',
    dataGB: purchase.dataGB || null,
    durationDays: purchase.durationDays || null,
    brandName: purchase.brandName || null,
    priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
    priceCurrency: purchase.price?.currency || null
  });

  await payment.update({
    esimId: esim.id,
    metadata: { ...payment.metadata, esimTransactionId: transactionId, esimId: esim.id }
  });

  return esim;
}

export async function topupEsimAfterPayment(payment) {
  // Check if this is a legacy Zendit payment
  if (payment.metadata?.vendor === 'zendit') {
    return zenditTopupEsimAfterPayment(payment);
  }

  const balanceCheck = await checkAiraloBalance(parseFloat(payment.amount));
  if (!balanceCheck.sufficient) {
    const msg = `Insufficient Airalo balance: available $${balanceCheck.available}, required $${balanceCheck.required}`;
    log.error({ merchantOid: payment.merchantOid, ...balanceCheck }, msg);
    throw new Error(msg);
  }

  const iccid = payment.targetIccid;
  log.info({ merchantOid: payment.merchantOid, packageId: payment.offerId, iccid }, 'Airalo top-up after payment');

  const parentEsim = await db.Esim.findOne({ where: { iccid, userId: payment.userId } });

  const topupResult = await airaloCreateTopup(payment.offerId, iccid, `Topup ${payment.merchantOid}`);
  const order = topupResult?.data || topupResult;

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId: String(order.id || order.code),
    status: 'completed',
    vendor: 'airalo',
    vendorOrderId: String(order.id),
    iccid,
    parentEsimId: parentEsim ? parentEsim.id : null,
    dataGB: order.data ? parseFloat(order.data) || null : null,
    durationDays: order.validity || null,
    brandName: order.package || null,
    priceAmount: order.price || null,
    priceCurrency: order.currency || 'USD',
    vendorData: { topup: true }
  });

  await payment.update({
    esimId: esim.id,
    metadata: { ...payment.metadata, esimTransactionId: String(order.id), esimId: esim.id }
  });

  await logAudit(ACTIONS.ESIM_TOPUP, {
    userId: payment.userId,
    entity: 'Esim',
    entityId: esim.id,
    details: { offerId: payment.offerId, iccid, airaloOrderId: order.id, merchantOid: payment.merchantOid }
  });

  log.info({ merchantOid: payment.merchantOid, airaloOrderId: order.id, esimId: esim.id }, 'Airalo top-up completed after payment');
  return esim;
}

async function zenditTopupEsimAfterPayment(payment) {
  const balance = await getZenditBalance();
  const availableUsd = balance.availableBalance / (balance.currencyDivisor || 100);
  if (availableUsd < parseFloat(payment.amount)) {
    throw new Error(`Insufficient Zendit balance: $${availableUsd.toFixed(2)}`);
  }

  const iccid = payment.targetIccid;
  const transactionId = uuidv4();
  const parentEsim = await db.Esim.findOne({ where: { iccid, userId: payment.userId } });

  const purchase = await zenditPurchaseEsim(payment.offerId, transactionId, iccid);

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId,
    status: normalizeStatus(purchase.status),
    vendor: 'zendit',
    iccid,
    parentEsimId: parentEsim ? parentEsim.id : null,
    country: purchase.country || process.env.COUNTRY || 'TR',
    dataGB: purchase.dataGB || null,
    durationDays: purchase.durationDays || null,
    brandName: purchase.brandName || null,
    priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
    priceCurrency: purchase.price?.currency || null
  });

  await payment.update({
    esimId: esim.id,
    metadata: { ...payment.metadata, esimTransactionId: transactionId, esimId: esim.id }
  });

  return esim;
}

export async function findByMerchantOid(merchantOid) {
  return db.Payment.findOne({ where: { merchantOid } });
}

export default {
  createPayment,
  createPaddleCheckout,
  verifyPaddleWebhook,
  processPaddleWebhook,
  purchaseEsimAfterPayment,
  topupEsimAfterPayment,
  findByMerchantOid,
 // checkZenditBalance,
  checkProviderBalance
};
