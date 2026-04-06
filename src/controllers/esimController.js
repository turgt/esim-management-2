import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listOffers, purchaseEsim, getPurchase, getPurchaseQrCode, getUsage, getEsimPlans, normalizeStatus, isCompletedStatus } from '../services/zenditClient.js';
import db from '../db/models/index.js';
import cacheService from '../services/cacheService.js';
import { getPaginationParams, buildPagination } from '../utils/pagination.js';
import { logAudit, ACTIONS, getIp } from '../services/auditService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'esim' });

// Load eSIM device compatibility data
const __esimFilename = fileURLToPath(import.meta.url);
const __esimDirname = path.dirname(__esimFilename);
const esimDevices = JSON.parse(fs.readFileSync(path.join(__esimDirname, '../data/esim-devices.json'), 'utf8'));

// Helper function to check if QR is ready (uses normalized status)
function isQrReady(status) {
  return isCompletedStatus(status);
}

// Public landing page with offers
export async function showLandingPage(req, res) {
  try {
    const country = process.env.COUNTRY || 'TR';

    let offers = cacheService.getLandingOffers(country);

    if (!offers) {
      log.info({ country }, 'Fetching landing offers from API');
      offers = await listOffers(country);
      cacheService.setLandingOffers(country, offers);
    }

    const activeOffers = offers.list.filter(o => o.enabled);

    res.render('landing', {
      title: 'DataPatch - eSIM Data Plans',
      offers: activeOffers,
      user: req.session?.user || null
    });
  } catch (err) {
    log.error({ err }, 'showLandingPage error');
    res.render('landing', {
      title: 'DataPatch - eSIM Data Plans',
      offers: [],
      user: req.session?.user || null
    });
  }
}

// eSIM compatibility checker page
export async function showCompatibility(req, res) {
  res.render('compatibility', {
    title: 'eSIM Compatibility',
    brands: esimDevices.brands,
    lastUpdated: esimDevices.lastUpdated
  });
}

// eSIM compatibility API endpoint
export async function checkCompatibility(req, res) {
  const { brand, model } = req.query;

  if (!brand) {
    return res.json({ brands: esimDevices.brands.map(b => b.name) });
  }

  const brandData = esimDevices.brands.find(b => b.name === brand);
  if (!brandData) {
    return res.json({ error: 'Brand not found', models: [] });
  }

  if (!model) {
    return res.json({ models: brandData.models });
  }

  const modelData = brandData.models.find(m => m.name === model);
  return res.json({ result: modelData || null });
}

// Teklifleri listele - CACHED
export async function showOffers(req, res) {
  try {
    const country = process.env.COUNTRY || 'TR';

    let offers = cacheService.getOffers(country);

    if (!offers) {
      log.info({ country }, 'Fetching offers from API');
      offers = await listOffers(country);
      cacheService.setOffers(country, offers);
    }

    const activeOffers = offers.list.filter(o => o.enabled);

    res.render('offers', {
      title: 'Offers',
      offers: activeOffers
    });
  } catch (err) {
    log.error({ err, apiError: err.response?.data }, 'showOffers error');
    res.render('error', { message: 'Failed to load offers' });
  }
}

// Satın alma işlemi
export async function createPurchase(req, res) {
  const transaction = await db.sequelize.transaction();

  try {
    const { offerId } = req.body;
    const userId = req.session.user.id;

    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      transaction
    });

    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      return res.render('error', { message: 'eSIM limit reached' });
    }

    const transactionId = uuidv4();
    log.info({ username: user.username, offerId, transactionId }, 'Creating eSIM purchase');

    const purchase = await purchaseEsim(offerId, transactionId);
    log.info({ transactionId, status: purchase.status }, 'Purchase created');

    const confirmation = purchase.confirmation || {};

    await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: normalizeStatus(purchase.status),
      iccid: confirmation.iccid || null,
      smdpAddress: confirmation.smdpAddress || null,
      activationCode: confirmation.externalReferenceId || confirmation.activationCode || null,
      country: purchase.country || process.env.COUNTRY || 'TR',
      dataGB: purchase.dataGB || null,
      durationDays: purchase.durationDays || null,
      brandName: purchase.brandName || null,
      priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
      priceCurrency: purchase.price?.currency || null
    }, { transaction });

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_PURCHASE, {
      userId: user.id, entity: 'Esim', entityId: null,
      details: { offerId, transactionId },
      ipAddress: getIp(req)
    });

    res.redirect(`/status/${transactionId}?purchased=true`);

  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'createPurchase error');
    res.render('error', { message: 'Failed to create purchase' });
  }
}

// Status sayfası - Her zaman fresh API call
export async function showStatus(req, res) {
  try {
    const txId = req.params.txId;

    log.info({ transactionId: txId }, 'Checking purchase status');

    const apiStatus = await getPurchase(txId);

    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId },
      include: [{
        model: db.User,
        as: 'owner',
        attributes: ['id', 'username']
      }]
    });

    if (!esimRecord) {
      log.warn({ transactionId: txId }, 'eSIM record not found');
      return res.render('error', { message: 'eSIM record not found in database' });
    }

    log.debug({ dbStatus: esimRecord.status, apiStatus: apiStatus.status }, 'Status comparison');

    const updateData = {};
    const normalizedApiStatus = normalizeStatus(apiStatus.status);
    if (esimRecord.status !== normalizedApiStatus) {
      updateData.status = normalizedApiStatus;
    }

    const confirmation = apiStatus.confirmation || {};
    if (!esimRecord.iccid && confirmation.iccid) {
      updateData.iccid = confirmation.iccid;
    }
    if (!esimRecord.smdpAddress && confirmation.smdpAddress) {
      updateData.smdpAddress = confirmation.smdpAddress;
    }
    // Update activationCode: prefer externalReferenceId, fix old short codes
    const correctCode = confirmation.externalReferenceId || confirmation.activationCode;
    if (correctCode && esimRecord.activationCode !== correctCode) {
      updateData.activationCode = correctCode;
    }

    let statusUpdated = false;
    if (Object.keys(updateData).length > 0) {
      try {
        await esimRecord.update(updateData);
        statusUpdated = true;
        log.info({ transactionId: txId, updatedFields: Object.keys(updateData) }, 'Record updated in database');
      } catch (updateError) {
        log.error({ err: updateError, transactionId: txId }, 'Failed to update database');
      }
    }

    const qrReady = isQrReady(apiStatus.status);
    log.debug({ transactionId: txId, qrReady }, 'QR ready check');

    // Fetch active plans if ICCID available
    let activePlans = null;
    if (esimRecord.iccid) {
      try {
        activePlans = await getEsimPlans(esimRecord.iccid);
      } catch (e) {
        log.warn({ err: e.message, iccid: esimRecord.iccid }, 'Could not fetch plans for status page');
      }
    }

    res.render('status', {
      title: 'Purchase Status',
      status: apiStatus,
      esim: esimRecord,
      isQrReady: qrReady,
      dbStatus: esimRecord.status,
      statusUpdated: statusUpdated,
      updatedAt: new Date().toLocaleTimeString(),
      activePlans
    });

  } catch (err) {
    log.error({ err, apiError: err.response?.data }, 'showStatus error');

    try {
      const esimRecord = await db.Esim.findOne({
        where: { transactionId: req.params.txId }
      });

      if (esimRecord) {
        log.warn({ transactionId: req.params.txId, dbStatus: esimRecord.status }, 'API failed, showing database status');
        return res.render('status', {
          title: 'Purchase Status',
          status: {
            transactionId: esimRecord.transactionId,
            offerId: esimRecord.offerId,
            status: esimRecord.status,
            statusMessage: 'Status from database (API temporarily unavailable)'
          },
          esim: esimRecord,
          isQrReady: isQrReady(esimRecord.status),
          dbStatus: esimRecord.status,
          apiError: true
        });
      }
    } catch (dbErr) {
      log.error({ err: dbErr }, 'Database fallback also failed');
    }

    res.render('error', { message: 'Failed to fetch status' });
  }
}

// QR Code sayfası - Her zaman fresh API call
export async function showQrCode(req, res) {
  try {
    const txId = req.params.txId;
    log.info({ transactionId: txId }, 'Fetching QR code');

    const apiStatus = await getPurchase(txId);
    log.debug({ transactionId: txId, status: apiStatus.status }, 'API status for QR');

    if (!isQrReady(apiStatus.status)) {
      return res.render('error', {
        message: `QR code not ready yet. Current status: ${apiStatus.status}`
      });
    }

    const qr = await getPurchaseQrCode(txId);

    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId },
      include: [{
        model: db.User,
        as: 'owner',
        attributes: ['id', 'username']
      }]
    });

    if (!esimRecord || (esimRecord.userId !== req.session.user.id && !req.session.user.isAdmin)) {
      return res.render('error', {
        message: 'You do not have permission to access this QR code'
      });
    }

    res.render('qrcode', {
      title: 'QR Code',
      qr,
      esim: esimRecord
    });

  } catch (err) {
    log.error({ err, apiError: err.response?.data }, 'showQrCode error');
    res.render('error', { message: 'Failed to fetch QR code' });
  }
}

// Kullanıcının satın aldığı eSIM'leri listele
export async function listUserPurchases(req, res) {
  try {
    const userId = req.session.user.id;
    const { page, limit, offset } = getPaginationParams(req);

    const { count, rows: purchases } = await db.Esim.findAndCountAll({
      where: { userId: userId },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const pagination = buildPagination(page, limit, count, req.query);

    const plansMap = {};
    const uniqueIccids = [...new Set(purchases.filter(p => p.iccid).map(p => p.iccid))];
    await Promise.all(uniqueIccids.map(async (iccid) => {
      try {
        const plans = await getEsimPlans(iccid);
        plansMap[iccid] = plans;
        log.debug({ iccid, planCount: plans?.list?.length || 0 }, 'Fetched eSIM plans');
      } catch (e) {
        log.warn({ iccid, err: e.message }, 'Failed to fetch eSIM plans');
      }
    }));

    // Fix old activation codes: fetch externalReferenceId from API
    await Promise.all(purchases.filter(p => p.activationCode && /^\d+$/.test(p.activationCode)).map(async (p) => {
      try {
        const apiData = await getPurchase(p.transactionId);
        const ref = apiData.confirmation?.externalReferenceId;
        if (ref && ref !== p.activationCode) {
          await p.update({ activationCode: ref });
          p.activationCode = ref;
        }
      } catch (e) { /* skip */ }
    }));

    res.render('purchases', {
      title: 'My Purchases',
      purchases,
      plansMap,
      pagination
    });

  } catch (err) {
    log.error({ err }, 'listUserPurchases error');
    res.render('error', { message: 'Failed to load purchases' });
  }
}

// Debug: compare DB vs API eSIM data (admin only)
export async function debugEsimData(req, res) {
  try {
    const txId = req.params.txId;
    const esim = await db.Esim.findOne({ where: { transactionId: txId } });
    if (!esim) return res.status(404).json({ error: 'eSIM not found' });

    const apiData = await getPurchase(txId);
    const confirmation = apiData.confirmation || {};

    const dbLpa = `LPA:1$${esim.smdpAddress}$${esim.activationCode}`;
    const apiLpa = `LPA:1$${confirmation.smdpAddress || ''}$${confirmation.activationCode || ''}`;

    // Decode Zendit QR code to see actual LPA string
    let qrContent = null;
    try {
      const qrData = await getPurchaseQrCode(txId);
      if (qrData && qrData.imageBase64) {
        const sharp = (await import('sharp')).default;
        const jsQR = (await import('jsqr')).default;
        const imgBuffer = Buffer.from(qrData.imageBase64, 'base64');
        const { data, info } = await sharp(imgBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
        qrContent = decoded ? decoded.data : 'QR decode failed';
      }
    } catch (e) {
      qrContent = 'Error: ' + e.message;
    }

    res.json({
      db: { smdpAddress: esim.smdpAddress, activationCode: esim.activationCode, lpa: dbLpa },
      api: { smdpAddress: confirmation.smdpAddress, activationCode: confirmation.activationCode, lpa: apiLpa, fullConfirmation: confirmation },
      qrContent,
      match: dbLpa === apiLpa,
      qrMatchesDb: qrContent === dbLpa,
      deepLinks: {
        apple: 'https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=' + (qrContent && qrContent.startsWith('LPA:') ? qrContent : apiLpa),
        android: 'https://esimsetup.android.com/esim_qrcode_provisioning?carddata=' + (qrContent && qrContent.startsWith('LPA:') ? qrContent : apiLpa)
      },
      plans: esim.iccid ? await getEsimPlans(esim.iccid).catch(e => ({ error: e.message })) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Debug: show unique subTypes from offers (admin only)
export async function debugOfferFields(req, res) {
  try {
    const country = process.env.COUNTRY || 'TR';
    let offers = cacheService.getOffers(country);
    if (!offers) {
      offers = await listOffers(country);
      cacheService.setOffers(country, offers);
    }
    const activeOffers = offers.list.filter(o => o.enabled);
    const subTypes = [...new Set(activeOffers.flatMap(o => o.subTypes || []))];
    const sample = activeOffers.slice(0, 3).map(o => ({
      offerId: o.offerId,
      brand: o.brand,
      dataGB: o.dataGB,
      dataUnlimited: o.dataUnlimited,
      durationDays: o.durationDays,
      subTypes: o.subTypes,
      dataSpeeds: o.dataSpeeds,
      shortNotes: o.shortNotes,
      notes: o.notes
    }));
    res.json({ totalOffers: activeOffers.length, uniqueSubTypes: subTypes, sampleOffers: sample });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Kullanım detayı
export async function showUsage(req, res) {
  try {
    const txId = req.params.txId;
    const usage = await getUsage(txId);

    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId }
    });

    if (!esimRecord || (esimRecord.userId !== req.session.user.id && !req.session.user.isAdmin)) {
      return res.render('error', { message: 'Access denied' });
    }

    res.json({ usage, esim: esimRecord });
  } catch (err) {
    log.error({ err, apiError: err.response?.data }, 'showUsage error');
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
}
