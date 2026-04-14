import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPurchase, getPurchaseQrCode, getUsage, getEsimPlans, normalizeStatus, isCompletedStatus } from '../services/zenditClient.js';
import db from '../db/models/index.js';
import { getPaginationParams, buildPagination } from '../utils/pagination.js';
import { logAudit, ACTIONS, getIp } from '../services/auditService.js';
import logger from '../lib/logger.js';
import { calcFinalPrice, getGlobalMarkup } from '../services/pricingService.js';
import { createOrder as airaloCreateOrder, getUsage as airaloGetUsage } from '../services/airaloClient.js';

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
    // Capture vendor ref code from QR and store in session
    if (req.query.ref) {
      req.session.vendorRef = req.query.ref;
    }
    const vendorRef = req.session.vendorRef || null;

    const packages = await db.AiraloPackage.findAll({
      order: [['price', 'ASC']],
      limit: 6,
    });

    const globalMarkup = await getGlobalMarkup();
    const featuredOffers = packages.map(pkg => {
      const plain = pkg.get({ plain: true });
      plain.finalPrice = calcFinalPrice(pkg, globalMarkup);
      return plain;
    });

    res.render('landing', {
      title: 'DataPatch - eSIM Data Plans',
      offers: featuredOffers,
      user: req.session?.user || null,
      vendorRef
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

export async function showOffers(req, res) {
  try {
    const country = req.query.country || '';
    const type = req.query.type || '';

    const where = {};
    if (country && country !== 'ALL') {
      where.countryCode = country;
    }
    if (type) {
      where.type = type;
    } else {
      where.type = { [db.Sequelize.Op.ne]: 'topup' };
    }

    const packages = await db.AiraloPackage.findAll({
      where,
      order: [['price', 'ASC']],
      limit: parseInt(process.env.OFFERS_LIMIT) || 100,
    });

    const globalMarkup = await getGlobalMarkup();

    // Attach finalPrice and rawData-derived fields to each package
    const offers = packages.map(pkg => {
      const plain = pkg.get({ plain: true });
      plain.finalPrice = calcFinalPrice(pkg, globalMarkup);

      const raw = plain.rawData || {};
      const op = raw.operator || {};

      // Best network speed: try operator.networks first, fall back to op.info text
      const networks = op.networks || [];
      const allTypes = networks.flatMap(n => n.types || []);
      if (allTypes.length > 0) {
        plain.bestSpeed = allTypes.includes('5G') ? '5G'
          : (allTypes.includes('4G') || allTypes.includes('LTE')) ? '4G'
          : allTypes.includes('3G') ? '3G' : '';
      } else {
        // Parse speed from op.info strings like "5G Data-only eSIM."
        const infoArr = Array.isArray(op.info) ? op.info : (op.info ? [op.info] : []);
        const infoJoined = infoArr.join(' ');
        plain.bestSpeed = /\b5G\b/i.test(infoJoined) ? '5G'
          : /\b4G\b|LTE/i.test(infoJoined) ? '4G'
          : /\b3G\b/i.test(infoJoined) ? '3G' : '';
      }

      // Data title for display (e.g. "1 GB - 7 days")
      plain.dataTitle = raw.title || raw.data || '';

      // Coverage countries
      const countries = op.countries || [];
      plain.coverageCountries = countries.map(c => c.title || c.country_code).filter(Boolean);

      // Fair usage policy
      plain.hasFairUsage = !!raw.is_fair_usage_policy;
      plain.fairUsagePolicy = raw.fair_usage_policy || '';

      // Notes: op.info only (excluding other_info), plus short_info and fair_usage_policy
      const noteParts = [];
      if (raw.short_info) noteParts.push(raw.short_info);
      if (op.info) {
        const infoItems = Array.isArray(op.info) ? op.info : [op.info];
        infoItems.forEach(item => {
          const s = String(item).trim();
          if (s && !noteParts.includes(s)) noteParts.push(s);
        });
      }
      if (raw.fair_usage_policy) noteParts.push(raw.fair_usage_policy);
      plain.note = noteParts.join(' — ');

      return plain;
    });

    // Retrieve distinct synced countries for the filter UI
    const syncedCountries = await db.AiraloPackage.findAll({
      attributes: [[db.Sequelize.fn('DISTINCT', db.Sequelize.col('countryCode')), 'countryCode']],
      raw: true,
    });
    const availableCountries = syncedCountries
      .map(r => r.countryCode)
      .filter(Boolean)
      .sort();

    res.render('offers', {
      title: 'Offers',
      offers,
      availableCountries,
      selectedCountry: country,
      compatBrands: esimDevices.brands.map(b => b.name),
    });
  } catch (err) {
    log.error({ err }, 'showOffers error');
    res.render('error', { message: 'Failed to load offers' });
  }
}

export async function createPurchase(req, res) {
  const transaction = await db.sequelize.transaction();

  try {
    const { packageId } = req.body;
    const userId = req.session.user.id;

    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      transaction
    });

    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      return res.render('error', { message: 'eSIM limit reached' });
    }

    log.info({ username: user.username, packageId }, 'Creating Airalo eSIM purchase');

    const orderResult = await airaloCreateOrder(packageId, 1, `User ${user.username}`);
    const order = orderResult?.data || orderResult;
    const sim = order.sims?.[0] || {};

    await db.Esim.create({
      userId: user.id,
      offerId: packageId,
      transactionId: String(order.id || order.code),
      status: 'completed',
      vendor: 'airalo',
      vendorOrderId: String(order.id),
      iccid: sim.iccid || null,
      smdpAddress: null,
      activationCode: null,
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
    }, { transaction });

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_PURCHASE, {
      userId: user.id, entity: 'Esim', entityId: null,
      details: { packageId, airaloOrderId: order.id },
      ipAddress: getIp(req)
    });

    res.redirect(`/status/${order.id || order.code}?purchased=true`);

  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'createPurchase error');
    res.render('error', { message: 'Failed to create purchase' });
  }
}

export async function showStatus(req, res) {
  try {
    const txId = req.params.txId;
    log.info({ transactionId: txId }, 'Checking purchase status');

    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId },
      include: [{ model: db.User, as: 'owner', attributes: ['id', 'username'] }]
    });

    if (!esimRecord) {
      return res.render('error', { message: 'eSIM record not found in database' });
    }

    // Ownership check — only owner or admin can view eSIM status
    if (esimRecord.userId !== req.session.user.id && !req.session.user.isAdmin) {
      return res.status(403).render('error', { message: 'Access denied', title: 'Forbidden' });
    }

    if (esimRecord.vendor === 'airalo') {
      let usageData = null;
      if (esimRecord.iccid) {
        try {
          const usage = await airaloGetUsage(esimRecord.iccid);
          usageData = usage?.data || null;
        } catch (e) {
          log.warn({ err: e.message, iccid: esimRecord.iccid }, 'Could not fetch Airalo usage');
        }
      }

      return res.render('status', {
        title: 'Purchase Status',
        esim: esimRecord,
        vendor: 'airalo',
        usageData,
        isQrReady: !!esimRecord.iccid,
        dbStatus: esimRecord.status,
      });
    }

    // Zendit: admin can query API, users see DB only
    if (req.session.user.isAdmin) {
      try {
        const apiStatus = await getPurchase(txId);
        const updateData = {};
        const normalizedApiStatus = normalizeStatus(apiStatus.status);
        if (esimRecord.status !== normalizedApiStatus) updateData.status = normalizedApiStatus;
        const confirmation = apiStatus.confirmation || {};
        if (!esimRecord.iccid && confirmation.iccid) updateData.iccid = confirmation.iccid;
        if (!esimRecord.smdpAddress && confirmation.smdpAddress) updateData.smdpAddress = confirmation.smdpAddress;
        const correctCode = confirmation.externalReferenceId || confirmation.activationCode;
        if (correctCode && esimRecord.activationCode !== correctCode) updateData.activationCode = correctCode;
        if (Object.keys(updateData).length > 0) await esimRecord.update(updateData);

        let activePlans = null;
        if (esimRecord.iccid) {
          try { activePlans = await getEsimPlans(esimRecord.iccid); } catch (e) { /* skip */ }
        }

        return res.render('status', {
          title: 'Purchase Status',
          status: apiStatus,
          esim: esimRecord,
          vendor: 'zendit',
          isQrReady: isQrReady(apiStatus.status),
          dbStatus: esimRecord.status,
          activePlans,
        });
      } catch (err) {
        log.warn({ err: err.message }, 'Zendit API failed, showing DB status');
      }
    }

    // Zendit fallback or non-admin
    res.render('status', {
      title: 'Purchase Status',
      esim: esimRecord,
      vendor: 'zendit',
      isQrReady: isQrReady(esimRecord.status),
      dbStatus: esimRecord.status,
      apiError: !req.session.user.isAdmin,
    });

  } catch (err) {
    log.error({ err }, 'showStatus error');
    res.render('error', { message: 'Failed to fetch status' });
  }
}

export async function showQrCode(req, res) {
  try {
    const txId = req.params.txId;

    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId },
      include: [{ model: db.User, as: 'owner', attributes: ['id', 'username'] }]
    });

    if (!esimRecord || (esimRecord.userId !== req.session.user.id && !req.session.user.isAdmin)) {
      return res.render('error', { message: 'Access denied' });
    }

    if (esimRecord.vendor === 'airalo') {
      const vd = esimRecord.vendorData || {};

      // Proxy QR image through our server so users don't need direct access to Airalo CDN
      let proxiedQrBase64 = null;
      const qrUrl = vd.qrcodeUrl || null; // qrcodeUrl is the image URL; vd.qrcode is LPA string, not a URL
      if (qrUrl) {
        try {
          const response = await fetch(qrUrl);
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            proxiedQrBase64 = buffer.toString('base64');
          }
        } catch (e) {
          log.warn({ err: e, qrUrl }, 'Failed to proxy Airalo QR image');
        }
      }
      // Fallback: generate QR from LPA string if proxy failed or no URL
      if (!proxiedQrBase64 && vd.qrcode) {
        try {
          const QRCode = (await import('qrcode')).default;
          const dataUrl = await QRCode.toDataURL(vd.qrcode, { width: 300, margin: 2 });
          proxiedQrBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        } catch (e) {
          log.warn({ err: e }, 'Failed to generate QR from LPA string');
        }
      }

      // Airalo data layout:
      //   vd.lpa = SM-DP+ address (e.g. "lpa.airalo.com")
      //   vd.qrcode = full LPA string (e.g. "LPA:1$lpa.airalo.com$MATCHING_ID")
      //   vd.matchingId = activation code
      const fullLpa = vd.qrcode || null;
      const smdpAddr = vd.lpa || (fullLpa ? fullLpa.split('$')[1] : null);
      const actCode = vd.matchingId || (fullLpa ? fullLpa.split('$')[2] : null);

      return res.render('qrcode', {
        title: 'QR Code',
        esim: esimRecord,
        vendor: 'airalo',
        qrcodeUrl: null,
        qr: proxiedQrBase64 ? { imageBase64: proxiedQrBase64 } : null,
        directAppleUrl: vd.directAppleUrl || null,
        lpa: fullLpa,
        matchingId: vd.matchingId || null,
        smdpAddress: smdpAddr,
        activationCode: actCode,
      });
    }

    // Zendit: admin-only QR code from API
    if (!req.session.user.isAdmin) {
      return res.render('error', { message: 'QR code only available through admin for legacy eSIMs' });
    }

    const apiStatus = await getPurchase(txId);
    if (!isQrReady(apiStatus.status)) {
      return res.render('error', { message: `QR code not ready. Status: ${apiStatus.status}` });
    }

    const qr = await getPurchaseQrCode(txId);
    res.render('qrcode', {
      title: 'QR Code',
      qr,
      esim: esimRecord,
      vendor: 'zendit',
    });

  } catch (err) {
    log.error({ err }, 'showQrCode error');
    res.render('error', { message: 'Failed to fetch QR code' });
  }
}

export async function listUserPurchases(req, res) {
  try {
    const userId = req.session.user.id;
    const { page, limit, offset } = getPaginationParams(req);

    const { count, rows: purchases } = await db.Esim.findAndCountAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const pagination = buildPagination(page, limit, count, req.query);

    // Only fetch usage for Airalo eSIMs with iccid
    const plansMap = {};
    const airaloIccids = [...new Set(
      purchases.filter(p => p.vendor === 'airalo' && p.iccid).map(p => p.iccid)
    )];
    await Promise.all(airaloIccids.map(async (iccid) => {
      try {
        const usage = await airaloGetUsage(iccid);
        plansMap[iccid] = usage?.data || null;
      } catch (e) {
        log.warn({ iccid, err: e.message }, 'Failed to fetch Airalo usage');
      }
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

// Debug: show package fields from AiraloPackage table (admin only)
export async function debugOfferFields(req, res) {
  try {
    const country = req.query.country || '';
    const where = {};
    if (country) {
      where.countryCode = country;
    }
    const packages = await db.AiraloPackage.findAll({
      where,
      order: [['price', 'ASC']],
      limit: 100,
    });
    const types = [...new Set(packages.map(p => p.type).filter(Boolean))];
    const countries = [...new Set(packages.map(p => p.countryCode).filter(Boolean))];
    const sample = packages.slice(0, 3).map(p => ({
      packageId: p.packageId,
      operatorTitle: p.operatorTitle,
      title: p.title,
      type: p.type,
      data: p.data,
      validity: p.validity,
      price: p.price,
      countryCode: p.countryCode,
    }));
    res.json({ totalPackages: packages.length, uniqueTypes: types, uniqueCountries: countries, samplePackages: sample });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function showUsage(req, res) {
  try {
    const txId = req.params.txId;
    const esimRecord = await db.Esim.findOne({ where: { transactionId: txId } });

    if (!esimRecord || (esimRecord.userId !== req.session.user.id && !req.session.user.isAdmin)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (esimRecord.vendor === 'airalo' && esimRecord.iccid) {
      const usage = await airaloGetUsage(esimRecord.iccid);
      return res.json({ usage: usage?.data, esim: esimRecord, vendor: 'airalo' });
    }

    if (esimRecord.vendor === 'zendit' && req.session.user.isAdmin) {
      const usage = await getUsage(txId);
      return res.json({ usage, esim: esimRecord, vendor: 'zendit' });
    }

    res.json({ usage: null, esim: esimRecord, vendor: esimRecord.vendor, message: 'Usage not available' });
  } catch (err) {
    log.error({ err }, 'showUsage error');
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
}
