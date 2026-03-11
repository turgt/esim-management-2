import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/models/index.js';
import { purchaseEsim, normalizeStatus, getBalance } from './zenditClient.js';
import { logAudit, ACTIONS } from './auditService.js';
import { sendPaymentSuccessEmail, sendPaymentFailedEmail, sendEsimActivationFailedEmail } from './emailService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'payment' });

const PAYTR_API_URL = 'https://www.paytr.com/odeme/api/get-token';

function getMerchantConfig() {
  return {
    merchantId: process.env.PAYTR_MERCHANT_ID || '',
    merchantKey: process.env.PAYTR_MERCHANT_KEY || '',
    merchantSalt: process.env.PAYTR_MERCHANT_SALT || '',
    testMode: process.env.PAYTR_TEST_MODE || '1'
  };
}

// Check if Zendit has enough balance to fulfill the eSIM purchase
export async function checkZenditBalance(amount) {
  try {
    const balance = await getBalance();
    const availableUsd = balance.availableBalance / (balance.currencyDivisor || 100);
    log.info({ availableUsd, requiredAmount: amount }, 'Zendit balance check');

    if (availableUsd < amount) {
      return { sufficient: false, available: availableUsd, required: amount };
    }
    return { sufficient: true, available: availableUsd, required: amount };
  } catch (err) {
    log.error({ err }, 'Failed to check Zendit balance');
    return { sufficient: false, available: 0, required: amount, error: err.message };
  }
}

export async function createPayment(userId, offerId, amount, currency = 'USD', metadata = {}, opts = {}) {
  const merchantOid = `ESIM_${Date.now()}_${uuidv4().slice(0, 8)}`;

  const payment = await db.Payment.create({
    userId,
    offerId,
    amount,
    currency,
    status: 'pending',
    provider: 'paytr',
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

export async function generatePaytrToken({ payment, user, userIp }) {
  const config = getMerchantConfig();

  if (!config.merchantId || !config.merchantKey || !config.merchantSalt) {
    throw new Error('PayTR credentials not configured');
  }

  const merchantOid = payment.merchantOid;
  const email = user.email || `${user.username}@datapatch.net`;
  const paymentAmount = Math.round(payment.amount * 100);
  const userName = user.displayName || user.username;

  const label = payment.type === 'topup' ? `eSIM Top-up - ${payment.offerId}` : `eSIM Plan - ${payment.offerId}`;
  const basket = JSON.stringify([[label, payment.amount.toString(), 1]]);
  const userBasket = Buffer.from(basket).toString('base64');

  const noInstallment = '1';
  const maxInstallment = '0';
  const currency = payment.currency === 'USD' ? 'USD' : 'TL';
  const testMode = config.testMode;

  const hashStr = config.merchantId + userIp + merchantOid + email + paymentAmount +
    userBasket + noInstallment + maxInstallment + currency + testMode + config.merchantSalt;

  const paytrToken = crypto
    .createHmac('sha256', config.merchantKey)
    .update(hashStr)
    .digest('base64');

  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  const params = new URLSearchParams({
    merchant_id: config.merchantId,
    user_ip: userIp,
    merchant_oid: merchantOid,
    email: email,
    payment_amount: paymentAmount.toString(),
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: testMode === '1' ? '1' : '0',
    no_installment: noInstallment,
    max_installment: maxInstallment,
    user_name: userName,
    user_phone: '05000000000',
    merchant_ok_url: `${appUrl}/payment/result/${merchantOid}`,
    merchant_fail_url: `${appUrl}/payment/result/${merchantOid}`,
    timeout_limit: '30',
    currency: currency,
    test_mode: testMode,
    user_address: 'N/A',
    lang: 'en'
  });

  const response = await fetch(PAYTR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await response.json();

  if (data.status !== 'success') {
    log.error({ merchantOid, reason: data.reason }, 'PayTR token request failed');
    throw new Error(`PayTR token error: ${data.reason || 'Unknown error'}`);
  }

  log.info({ merchantOid }, 'PayTR token generated successfully');
  return data.token;
}

export function verifyCallback(body) {
  const config = getMerchantConfig();
  const { merchant_oid, status, total_amount, hash } = body;

  const hashStr = merchant_oid + config.merchantSalt + status + total_amount;
  const expectedHash = crypto
    .createHmac('sha256', config.merchantKey)
    .update(hashStr)
    .digest('base64');

  return hash === expectedHash;
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

export async function processCallback(body) {
  const { merchant_oid, status, total_amount } = body;

  const payment = await findByMerchantOid(merchant_oid);
  if (!payment) {
    log.warn({ merchant_oid }, 'Callback for unknown payment');
    return null;
  }

  // Idempotent: skip if already processed
  if (payment.status !== 'pending') {
    log.info({ merchant_oid, existingStatus: payment.status }, 'Payment already processed, skipping');
    return payment;
  }

  if (status === 'success') {
    await payment.update({
      status: 'completed',
      providerTransactionId: merchant_oid,
      metadata: { ...payment.metadata, paytrCallback: body, paidAmount: total_amount }
    });

    log.info({ merchant_oid, paymentId: payment.id }, 'Payment completed');

    await logAudit(ACTIONS.PAYMENT_SUCCESS, {
      userId: payment.userId,
      entity: 'Payment',
      entityId: payment.id,
      details: { merchant_oid, total_amount }
    });

    // Trigger eSIM purchase (or top-up)
    let esim = null;
    try {
      if (payment.type === 'topup' && payment.targetIccid) {
        esim = await topupEsimAfterPayment(payment);
      } else {
        esim = await purchaseEsimAfterPayment(payment);
      }
      await sendEmailNotification(payment, esim);
    } catch (err) {
      log.error({ err, merchant_oid }, 'eSIM purchase failed after successful payment');
      await payment.update({
        metadata: {
          ...payment.metadata,
          esimPurchaseError: err.message,
          esimPurchaseFailed: true
        }
      });
      await sendEmailNotification(payment, null);
    }
  } else {
    await payment.update({
      status: 'failed',
      metadata: { ...payment.metadata, paytrCallback: body }
    });

    log.info({ merchant_oid, paymentId: payment.id }, 'Payment failed');

    await logAudit(ACTIONS.PAYMENT_FAILED, {
      userId: payment.userId,
      entity: 'Payment',
      entityId: payment.id,
      details: { merchant_oid, status }
    });

    await sendEmailNotification(payment, null);
  }

  return payment;
}

export async function purchaseEsimAfterPayment(payment) {
  const balanceCheck = await checkZenditBalance(parseFloat(payment.amount));
  if (!balanceCheck.sufficient) {
    const msg = `Insufficient Zendit balance: available $${balanceCheck.available.toFixed(2)}, required $${balanceCheck.required.toFixed(2)}`;
    log.error({ merchantOid: payment.merchantOid, ...balanceCheck }, msg);
    throw new Error(msg);
  }

  const transactionId = uuidv4();
  log.info({ merchantOid: payment.merchantOid, offerId: payment.offerId, transactionId }, 'Purchasing eSIM after payment');

  const purchase = await purchaseEsim(payment.offerId, transactionId);
  const confirmation = purchase.confirmation || {};

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId,
    status: normalizeStatus(purchase.status),
    iccid: confirmation.iccid || null,
    smdpAddress: confirmation.smdpAddress || null,
    activationCode: confirmation.activationCode || null,
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

  await logAudit(ACTIONS.ESIM_PURCHASE, {
    userId: payment.userId,
    entity: 'Esim',
    entityId: esim.id,
    details: { offerId: payment.offerId, transactionId, merchantOid: payment.merchantOid }
  });

  log.info({ merchantOid: payment.merchantOid, transactionId, esimId: esim.id }, 'eSIM purchased successfully after payment');
  return esim;
}

export async function topupEsimAfterPayment(payment) {
  const balanceCheck = await checkZenditBalance(parseFloat(payment.amount));
  if (!balanceCheck.sufficient) {
    const msg = `Insufficient Zendit balance: available $${balanceCheck.available.toFixed(2)}, required $${balanceCheck.required.toFixed(2)}`;
    log.error({ merchantOid: payment.merchantOid, ...balanceCheck }, msg);
    throw new Error(msg);
  }

  const iccid = payment.targetIccid;
  const transactionId = uuidv4();
  log.info({ merchantOid: payment.merchantOid, offerId: payment.offerId, iccid, transactionId }, 'Top-up eSIM after payment');

  const parentEsim = await db.Esim.findOne({ where: { iccid, userId: payment.userId } });

  const purchase = await purchaseEsim(payment.offerId, transactionId, iccid);
  const confirmation = purchase.confirmation || {};

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId,
    status: normalizeStatus(purchase.status),
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

  await logAudit(ACTIONS.ESIM_TOPUP, {
    userId: payment.userId,
    entity: 'Esim',
    entityId: esim.id,
    details: { offerId: payment.offerId, transactionId, iccid, merchantOid: payment.merchantOid }
  });

  log.info({ merchantOid: payment.merchantOid, transactionId, esimId: esim.id }, 'eSIM top-up completed after payment');
  return esim;
}

export async function findByMerchantOid(merchantOid) {
  return db.Payment.findOne({ where: { merchantOid } });
}

export default {
  createPayment,
  generatePaytrToken,
  verifyCallback,
  processCallback,
  purchaseEsimAfterPayment,
  topupEsimAfterPayment,
  findByMerchantOid,
  checkZenditBalance
};
