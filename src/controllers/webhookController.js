import db from '../db/models/index.js';
import logger from '../lib/logger.js';
import { logAudit, ACTIONS } from '../services/auditService.js';

const log = logger.child({ module: 'webhook' });

export async function handleAiraloWebhook(req, res) {
  const payload = req.body;
  const webhookType = payload?.type || payload?.event || 'unknown';
  const airaloRequestId = payload?.data?.request_id || payload?.request_id || null;

  // Immediately persist raw payload
  let webhookLog;
  try {
    webhookLog = await db.AiraloWebhookLog.create({
      webhookType,
      airaloRequestId,
      payload,
      processStatus: 'pending',
      receivedAt: new Date()
    });
  } catch (err) {
    log.error({ err, payload }, 'Failed to persist webhook log');
  }

  // Return 200 immediately (prevent Airalo retry)
  res.status(200).json({ received: true });

  // Process async
  try {
    await processWebhook(webhookLog || { id: null, webhookType, airaloRequestId, payload });
  } catch (err) {
    log.error({ err, webhookLogId: webhookLog?.id }, 'Webhook processing failed');
    if (webhookLog) {
      await webhookLog.update({ processStatus: 'failed', error: err.message }).catch(() => {});
    }
  }
}

export async function processWebhook(webhookLog) {
  const { webhookType, airaloRequestId, payload } = webhookLog;

  if (!airaloRequestId) {
    log.warn({ webhookType }, 'Webhook without request_id — skipping');
    if (webhookLog.id) {
      await webhookLog.update({ processStatus: 'failed', error: 'No request_id in payload' });
    }
    return;
  }

  // Idempotency check
  const existing = await db.AiraloWebhookLog.findOne({
    where: {
      airaloRequestId,
      webhookType,
      processStatus: 'success',
      id: { [db.Sequelize.Op.ne]: webhookLog.id || 0 }
    }
  });
  if (existing) {
    log.info({ airaloRequestId, webhookType }, 'Duplicate webhook — skipping');
    if (webhookLog.id) {
      await webhookLog.update({ processStatus: 'success', processedAt: new Date(), error: 'duplicate — skipped' });
    }
    return;
  }

  // Find booking
  const booking = await db.TravelerBooking.findOne({
    where: { airaloRequestId },
    include: [
      { model: db.AgencyContract, as: 'contract', include: [{ model: db.AiraloPackage, as: 'package' }] },
      { model: db.Agency }
    ]
  });

  if (!booking) {
    log.warn({ airaloRequestId, webhookType }, 'No booking found for webhook request_id');
    if (webhookLog.id) {
      await webhookLog.update({ processStatus: 'failed', error: 'No matching booking' });
    }
    return;
  }

  if (webhookLog.id) {
    await webhookLog.update({ travelerBookingId: booking.id });
  }

  // Process by type
  if (webhookType === 'future_order_fulfilled' || webhookType === 'order.completed') {
    await handleFulfilled(booking, payload);
  } else if (webhookType === 'future_order_failed' || webhookType === 'order.failed') {
    await handleFailed(booking);
  } else if (webhookType === 'esim_activated' || webhookType === 'sim.activated') {
    await handleActivated(booking);
  } else {
    log.info({ webhookType, airaloRequestId }, 'Unhandled webhook type');
  }

  if (webhookLog.id) {
    await webhookLog.update({ processStatus: 'success', processedAt: new Date() });
  }

  await logAudit(ACTIONS.WEBHOOK_PROCESSED, {
    entity: 'TravelerBooking',
    entityId: booking.id,
    details: { webhookType, airaloRequestId }
  });
}

async function handleFulfilled(booking, payload) {
  const simData = payload?.data?.sims?.[0] || payload?.data || {};
  const transaction = await db.sequelize.transaction();

  try {
    const esim = await db.Esim.create({
      userId: null,
      offerId: booking.contract?.package?.packageId || null,
      transactionId: String(simData.id || simData.order_id || booking.airaloRequestId),
      status: 'completed',
      vendor: 'airalo',
      vendorOrderId: String(simData.order_id || simData.id || ''),
      iccid: simData.iccid || null,
      smdpAddress: simData.smdp_address || null,
      activationCode: simData.matching_id || simData.activation_code || null,
      country: booking.contract?.package?.countryCode || null,
      dataGB: booking.contract?.package?.amount ? booking.contract.package.amount / 1024 : null,
      durationDays: booking.contract?.package?.day || null,
      brandName: booking.contract?.package?.operatorTitle || null,
      priceAmount: booking.contract?.unitPriceAmount || null,
      priceCurrency: booking.contract?.unitPriceCurrency || null,
      vendorData: {
        lpa: simData.lpa || null,
        matchingId: simData.matching_id || null,
        qrcodeUrl: simData.qrcode_url || null,
        apn: simData.apn || null,
        airaloRequestId: booking.airaloRequestId
      },
      travelerBookingId: booking.id
    }, { transaction });

    await booking.update({
      status: 'provisioned',
      esimId: esim.id,
      provisionedAt: new Date()
    }, { transaction });

    await transaction.commit();
    log.info({ bookingId: booking.id, iccid: esim.iccid }, 'Booking provisioned via webhook');

    // Send "eSIM ready" email to traveler (non-blocking)
    if (booking.travelerEmail) {
      const appUrl = process.env.APP_URL || 'https://datapatch.app';
      import('../services/emailService.js').then(mod => {
        const sendMail = mod.sendMail || mod.default?.sendMail || mod.default;
        if (typeof sendMail === 'function') {
          sendMail(booking.travelerEmail, "eSIM'in hazir!",
            `<p>Merhaba ${booking.travelerName},</p>
             <p>eSIM'in hazir! Asagidaki linkten kurabilirsin:</p>
             <p><a href="${appUrl}/e/${booking.token}">eSIM'i Kur</a></p>
             <p>30 gun icinde kurulmasi gerekmektedir.</p>`,
            { type: 'esim_ready', userId: null }
          ).catch(err => log.error({ err, bookingId: booking.id }, 'Provisioned email failed'));
        }
      }).catch(() => {});
    }
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleFailed(booking) {
  const transaction = await db.sequelize.transaction();
  try {
    await booking.update({ status: 'failed' }, { transaction });
    await booking.contract.decrement('usedQuantity', { by: 1, transaction });
    if (booking.contract.status === 'exhausted') {
      await booking.contract.update({ status: 'active' }, { transaction });
    }
    await transaction.commit();
    log.warn({ bookingId: booking.id }, 'Booking failed via webhook');
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleActivated(booking) {
  if (booking.status === 'provisioned') {
    await booking.update({ status: 'installed' });
    log.info({ bookingId: booking.id }, 'Booking marked as installed');
  }
}
