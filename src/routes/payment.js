import { Router } from 'express';
import { ensureAuth } from '../middleware/auth.js';
import {
  createPayment,
  createPaddleCheckout,
  findByMerchantOid,
  checkProviderBalance,
  createTurInvoiceCheckout,
  getTurInvoiceStatus
} from '../services/paymentService.js';
import { getPaginationParams, buildPagination } from '../utils/pagination.js';
import { listOffers } from '../services/zenditClient.js';
import { getTopupPackages as getAiraloTopupPackages } from '../services/airaloClient.js';
import cacheService from '../services/cacheService.js';
import { getEsimPlans } from '../services/zenditClient.js';
import logger from '../lib/logger.js';
import { serveQrCode } from '../controllers/turInvoiceController.js';
import { isEnabled as turInvoiceEnabled, isInitialized as turInvoiceReady } from '../services/turInvoiceClient.js';
import { calcFinalPrice, getGlobalMarkup } from '../services/pricingService.js';

const router = Router();
const log = logger.child({ module: 'payment-routes' });

// TurInvoice QR code proxy
router.get('/turinvoice/qr/:idOrder', ensureAuth, serveQrCode);

// POST /payment/create — Start payment flow (authenticated + CSRF)
router.post('/create', ensureAuth, async (req, res) => {
  try {
    // Support both packageId (Airalo) and offerId (Zendit legacy)
    const offerId = req.body.packageId || req.body.offerId;
    const { amount, currency } = req.body;
    const vendor = req.body.vendor || 'airalo';

    if (!offerId || !amount) {
      return res.render('error', { message: 'Missing offer or amount', title: 'Error' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.render('error', { message: 'Invalid amount', title: 'Error' });
    }

    // Server-side price verification — prevent amount manipulation
    const db = (await import('../db/models/index.js')).default;
    const pkg = await db.AiraloPackage.findOne({ where: { packageId: offerId } });
    if (!pkg) {
      log.warn({ offerId, userId: req.session?.user?.id }, 'Package not found during price verification');
      return res.render('error', { message: 'Package not found', title: 'Error' });
    }
    const globalMarkup = await getGlobalMarkup();
    const correctPrice = calcFinalPrice(pkg, globalMarkup);
    if (Math.abs(parsedAmount - correctPrice) > 0.01) {
      log.warn({
        offerId,
        submittedAmount: parsedAmount,
        correctPrice,
        userId: req.session?.user?.id
      }, 'PRICE MISMATCH — possible amount manipulation');
      return res.render('error', { message: 'Price mismatch. Please refresh and try again.', title: 'Error' });
    }

    // Check provider balance BEFORE accepting payment
    const balanceCheck = await checkProviderBalance(correctPrice);
    if (!balanceCheck.sufficient) {
      log.warn({ offerId, amount: parsedAmount, ...balanceCheck }, 'Provider balance insufficient, blocking payment');
      return res.render('error', {
        message: 'This plan is temporarily unavailable. Please try again later or contact support.',
        title: 'Unavailable'
      });
    }

    const userId = req.session.user.id;
    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }]
    });

    if (!user) {
      return res.render('error', { message: 'User not found', title: 'Error' });
    }

    // Check eSIM limit before accepting payment
    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      return res.render('error', { message: 'You have reached your eSIM limit.', title: 'Limit Reached' });
    }

    const providerExplicit = req.body.provider; // undefined if not explicitly chosen
    const provider = providerExplicit || 'paddle';
    const paymentType = req.body.paymentType || 'qr';
    const showMethodSelection = !providerExplicit && turInvoiceEnabled() && turInvoiceReady();

    const payment = await createPayment(userId, offerId, correctPrice, currency || 'USD', {
      planName: req.body.planName || offerId,
      vendor,
      provider: showMethodSelection ? 'pending' : provider
    });

    // If TurInvoice is enabled and user hasn't chosen a method yet, show selection page
    if (showMethodSelection) {
      return res.render('payment', {
        title: 'Payment',
        user: req.session.user,
        payment,
        paymentMode: 'method-selection',
        paddleTransactionId: null,
        paddleClientToken: process.env.PADDLE_CLIENT_TOKEN || '',
        paddleEnvironment: process.env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
        offerId,
        amount: correctPrice,
        currency: currency || 'USD',
        turInvoiceEnabled: true,
        turInvoiceReady: true
      });
    }

    if (provider === 'turinvoice') {
      try {
        const turResult = await createTurInvoiceCheckout({ payment, paymentType });

        if (paymentType === 'card') {
          return res.redirect(turResult.paymentUrl);
        }

        return res.render('payment', {
          title: 'Payment',
          user: req.session.user,
          payment,
          paymentMode: 'turinvoice-qr',
          turInvoiceIdOrder: turResult.idOrder,
          turInvoicePaymentUrl: turResult.paymentUrl,
          offerId,
          amount,
          currency,
          turInvoiceEnabled: true,
          turInvoiceReady: true
        });
      } catch (err) {
        log.error({ err }, 'TurInvoice checkout failed');
        return res.render('error', {
          title: 'Payment Error',
          user: req.session.user,
          message: 'Odeme baslatilamadi. Lutfen tekrar deneyin.'
        });
      }
    }

    try {
      const { paddleTransactionId } = await createPaddleCheckout({ payment, user });
      await payment.update({ providerTransactionId: paddleTransactionId });
      res.render('payment', {
        title: 'Payment',
        user: req.session.user,
        payment,
        paddleTransactionId,
        paddleClientToken: process.env.PADDLE_CLIENT_TOKEN || '',
        paddleEnvironment: process.env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
        offerId,
        amount: correctPrice,
        currency: currency || 'USD',
        turInvoiceEnabled: turInvoiceEnabled() && turInvoiceReady(),
        turInvoiceReady: turInvoiceReady()
      });
    } catch (checkoutErr) {
      log.error({ err: checkoutErr, merchantOid: payment.merchantOid }, 'Paddle checkout creation failed');
      await payment.update({ status: 'failed', metadata: { ...payment.metadata, checkoutError: checkoutErr.message } });
      res.render('error', {
        message: 'Payment system temporarily unavailable. Please try again later.',
        title: 'Payment Error'
      });
    }
  } catch (err) {
    log.error({ err }, 'Payment create error');
    res.render('error', { message: 'Failed to start payment', title: 'Error' });
  }
});

// POST /payment/topup/create — Start top-up payment flow
router.post('/topup/create', ensureAuth, async (req, res) => {
  try {
    // Support both packageId (Airalo) and offerId (Zendit legacy)
    const offerId = req.body.packageId || req.body.offerId;
    const { amount, currency, esimId } = req.body;

    if (!offerId || !amount || !esimId) {
      return res.render('error', { message: 'Missing required fields', title: 'Error' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.render('error', { message: 'Invalid amount', title: 'Error' });
    }

    const userId = req.session.user.id;
    const db = (await import('../db/models/index.js')).default;
    const esim = await db.Esim.findByPk(esimId);

    if (!esim || esim.userId !== userId) {
      return res.render('error', { message: 'eSIM not found', title: 'Error' });
    }

    // Server-side price verification for topup packages
    let verifiedPrice = parsedAmount;
    if (esim.vendor === 'airalo' && esim.iccid) {
      try {
        const topupData = await getAiraloTopupPackages(esim.iccid);
        const topupPkgs = topupData?.data || [];
        const matchedPkg = topupPkgs.find(p => String(p.id) === String(offerId));
        if (!matchedPkg) {
          log.warn({ offerId, iccid: esim.iccid, userId }, 'Topup package not found during price verification');
          return res.render('error', { message: 'Package not found', title: 'Error' });
        }
        const apiPrice = parseFloat(matchedPkg.price);
        if (Math.abs(parsedAmount - apiPrice) > 0.01) {
          log.warn({ offerId, submittedAmount: parsedAmount, correctPrice: apiPrice, userId }, 'TOPUP PRICE MISMATCH — possible amount manipulation');
          return res.render('error', { message: 'Price mismatch. Please refresh and try again.', title: 'Error' });
        }
        verifiedPrice = apiPrice;
      } catch (priceErr) {
        log.error({ err: priceErr, offerId }, 'Failed to verify topup price');
        return res.render('error', { message: 'Unable to verify price. Please try again.', title: 'Error' });
      }
    }

    const balanceCheck = await checkProviderBalance(verifiedPrice);
    if (!balanceCheck.sufficient) {
      return res.render('error', {
        message: 'Top-up is temporarily unavailable. Please try again later.',
        title: 'Unavailable'
      });
    }

    const user = await db.User.findByPk(userId);
    if (!user) {
      return res.render('error', { message: 'User not found', title: 'Error' });
    }

    const vendor = esim.vendor || 'airalo';

    const targetIccid = esim.iccid;
    const payment = await createPayment(userId, offerId, verifiedPrice, currency || 'USD', {
      planName: req.body.planName || offerId,
      targetEsimId: esim.id,
      targetIccid,
      vendor
    }, { type: 'topup', targetIccid });

    try {
      const { paddleTransactionId } = await createPaddleCheckout({ payment, user });
      await payment.update({ providerTransactionId: paddleTransactionId });
      res.render('payment', {
        title: 'Payment',
        payment,
        paddleTransactionId,
        paddleClientToken: process.env.PADDLE_CLIENT_TOKEN || '',
        paddleEnvironment: process.env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
        offerId,
        amount: verifiedPrice,
        currency: currency || 'USD'
      });
    } catch (checkoutErr) {
      log.error({ err: checkoutErr, merchantOid: payment.merchantOid }, 'Paddle checkout creation failed');
      await payment.update({ status: 'failed', metadata: { ...payment.metadata, checkoutError: checkoutErr.message } });
      res.render('error', {
        message: 'Payment system temporarily unavailable. Please try again later.',
        title: 'Payment Error'
      });
    }
  } catch (err) {
    log.error({ err }, 'Topup payment create error');
    res.render('error', { message: 'Failed to start top-up payment', title: 'Error' });
  }
});

// GET /payment/topup/:esimId — Show top-up plan selection
router.get('/topup/:esimId', ensureAuth, async (req, res) => {
  try {
    const db = (await import('../db/models/index.js')).default;
    const esim = await db.Esim.findByPk(req.params.esimId);

    if (!esim || esim.userId !== req.session.user.id) {
      return res.render('error', { message: 'eSIM not found', title: 'Error' });
    }

    if (!esim.iccid) {
      return res.render('error', { message: 'This eSIM does not have an ICCID yet. Top-up is not available.', title: 'Error' });
    }

    let activeOffers = [];
    let activePlans = null;

    if (esim.vendor === 'airalo') {
      // Fetch Airalo-specific topup packages for this eSIM
      try {
        const topupData = await getAiraloTopupPackages(esim.iccid);
        activeOffers = topupData?.data || [];
      } catch (e) {
        log.warn({ err: e.message, iccid: esim.iccid }, 'Failed to fetch Airalo topup packages');
      }
    } else {
      // Zendit legacy: fetch offers by country
      const country = esim.country || process.env.COUNTRY || 'TR';
      let offers = cacheService.getOffers(country);
      if (!offers) {
        offers = await listOffers(country);
        cacheService.setOffers(country, offers);
      }
      activeOffers = offers.list.filter(o => o.enabled);

      try {
        activePlans = await getEsimPlans(esim.iccid);
      } catch (e) {
        // silently skip
      }
    }

    res.render('topup', {
      title: 'Top-up eSIM',
      esim,
      offers: activeOffers,
      activePlans
    });
  } catch (err) {
    log.error({ err }, 'Show topup page error');
    res.render('error', { message: 'Failed to load top-up page', title: 'Error' });
  }
});

// GET /payment/history — User payment history
router.get('/history', ensureAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { page, limit, offset } = getPaginationParams(req);
    const db = (await import('../db/models/index.js')).default;

    const { count, rows: payments } = await db.Payment.findAndCountAll({
      where: { userId },
      include: [{ model: db.Esim, attributes: ['id', 'transactionId', 'iccid', 'status', 'brandName'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const pagination = buildPagination(page, limit, count, req.query);

    const totalCompleted = await db.Payment.count({ where: { userId, status: 'completed' } });
    const totalFailed = await db.Payment.count({ where: { userId, status: 'failed' } });

    res.render('payment-history', {
      title: 'My Payments',
      payments,
      pagination,
      stats: { total: count, completed: totalCompleted, failed: totalFailed }
    });
  } catch (err) {
    log.error({ err }, 'Payment history error');
    res.render('error', { message: 'Failed to load payment history', title: 'Error' });
  }
});

// GET /payment/receipt/:merchantOid — Receipt page
router.get('/receipt/:merchantOid', ensureAuth, async (req, res) => {
  try {
    const db = (await import('../db/models/index.js')).default;
    const payment = await findByMerchantOid(req.params.merchantOid);

    if (!payment) {
      return res.render('error', { message: 'Payment not found', title: 'Error' });
    }

    // Allow own payments or admin access
    if (payment.userId !== req.session.user.id && !req.session.user.isAdmin) {
      return res.render('error', { message: 'Access denied', title: 'Error' });
    }

    if (payment.status !== 'completed') {
      return res.render('error', { message: 'Receipt is only available for completed payments', title: 'Error' });
    }

    const esim = payment.esimId ? await db.Esim.findByPk(payment.esimId) : null;
    const paymentUser = await db.User.findByPk(payment.userId, { attributes: ['id', 'username', 'displayName', 'email'] });

    res.render('receipt', {
      title: 'Receipt',
      payment,
      esim,
      paymentUser
    });
  } catch (err) {
    log.error({ err }, 'Receipt page error');
    res.render('error', { message: 'Failed to load receipt', title: 'Error' });
  }
});

// GET /payment/result/:merchantOid — Result page (polling)
router.get('/result/:merchantOid', ensureAuth, async (req, res) => {
  try {
    const payment = await findByMerchantOid(req.params.merchantOid);

    if (!payment || (payment.userId !== req.session.user.id && !req.session.user.isAdmin)) {
      return res.render('error', {
        title: 'Payment Not Found',
        errorTitle: 'Payment Not Found',
        errorMessage: 'The requested payment could not be found.',
        user: req.session.user
      });
    }

    res.render('payment-result', {
      title: 'Payment Result',
      payment
    });
  } catch (err) {
    log.error({ err }, 'Payment result page error');
    res.render('error', {
      title: 'Error',
      errorTitle: 'Something went wrong',
      errorMessage: 'Failed to load payment result.',
      user: req.session.user
    });
  }
});

// GET /payment/status/:merchantOid — JSON polling endpoint
router.get('/status/:merchantOid', ensureAuth, async (req, res) => {
  try {
    const payment = await findByMerchantOid(req.params.merchantOid);

    if (!payment || payment.userId !== req.session.user.id) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // TurInvoice status polling
    if (payment.provider === 'turinvoice' && payment.status === 'pending') {
      try {
        await getTurInvoiceStatus(payment);
        await payment.reload();
      } catch (err) {
        log.error({ err, merchantOid: req.params.merchantOid }, 'TurInvoice status poll failed');
      }
    }

    res.json({
      status: payment.status,
      merchantOid: payment.merchantOid,
      esimTransactionId: payment.metadata?.esimTransactionId || null,
      esimPurchaseFailed: payment.metadata?.esimPurchaseFailed || false
    });
  } catch (err) {
    log.error({ err }, 'Payment status poll error');
    res.status(500).json({ error: 'Failed to check status' });
  }
});

export default router;
