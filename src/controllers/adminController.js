import db from '../db/models/index.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { listOffers, purchaseEsim as zenditPurchaseEsim, getUsage as zenditGetUsage, getBalance as zenditGetBalance, getEsimPlans, normalizeStatus } from '../services/zenditClient.js';
import { createOrder as airaloCreateOrder, getUsage as airaloGetUsage, getBalance as airaloGetBalance } from '../services/airaloClient.js';
import { purchaseEsimAfterPayment, topupEsimAfterPayment } from '../services/paymentService.js';
import cacheService from '../services/cacheService.js';
import { sendEsimAssignedEmail } from '../services/emailService.js';
import { getPaginationParams, buildPagination } from '../utils/pagination.js';
import { logAudit, ACTIONS, getIp } from '../services/auditService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'admin' });

// Admin Dashboard
export async function showDashboard(req, res) {
  try {
    const totalUsers = await db.User.count();
    const totalEsims = await db.Esim.count();
    const activeEsims = await db.Esim.count({ where: { status: 'completed' } });
    const pendingEsims = await db.Esim.count({ where: { status: 'pending' } });

    let balance = null;
    try {
      balance = await airaloGetBalance();
    } catch (e) {
      log.warn({ err: e }, 'Could not fetch Airalo balance, trying Zendit');
      try {
        balance = await zenditGetBalance();
      } catch (e2) {
        log.warn({ err: e2 }, 'Could not fetch Zendit balance either');
      }
    }

    const recentEsims = await db.Esim.findAll({
      include: [{ model: db.User, as: 'owner', attributes: ['id', 'username', 'displayName'] }],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    const recentUsers = await db.User.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5
    });

    // Payment stats
    const totalPayments = await db.Payment.count();
    const completedPayments = await db.Payment.count({ where: { status: 'completed' } });
    const failedPayments = await db.Payment.count({ where: { status: 'failed' } });
    const pendingPayments = await db.Payment.count({ where: { status: 'pending' } });
    const totalRevenue = await db.Payment.sum('amount', { where: { status: 'completed' } }) || 0;

    const recentPayments = await db.Payment.findAll({
      include: [{ model: db.User, attributes: ['id', 'username', 'displayName'] }],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { totalUsers, totalEsims, activeEsims, pendingEsims },
      paymentStats: { totalPayments, completedPayments, failedPayments, pendingPayments, totalRevenue },
      balance,
      recentEsims,
      recentUsers,
      recentPayments
    });
  } catch (err) {
    log.error({ err }, 'showDashboard error');
    res.render('error', { message: 'Failed to load dashboard' });
  }
}

// Show all users
export async function listUsers(req, res) {
  try {
    const { page, limit, offset } = getPaginationParams(req);
    const { Op } = db.Sequelize;
    const search = req.query.search || '';
    const where = {};

    if (search) {
      where[Op.or] = [
        { username: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { displayName: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: users } = await db.User.findAndCountAll({
      where,
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      order: [['id', 'ASC']],
      limit,
      offset,
      distinct: true
    });
    const pagination = buildPagination(page, limit, count, req.query);
    res.render('admin/users', { title: 'Manage Users', users, pagination, search });
  } catch (err) {
    log.error({ err }, 'listUsers error');
    res.render('error', { message: 'Failed to load users' });
  }
}

// Create user
export async function createUser(req, res) {
  try {
    const { username, email, password, esimLimit } = req.body;
    const hash = await bcrypt.hash(password, 10);

    const newUser = await db.User.create({
      username,
      email: email || null,
      passwordHash: hash,
      isAdmin: false,
      isActive: true,
      esimLimit: esimLimit || null
    });

    await logAudit(ACTIONS.USER_CREATE, {
      userId: req.session.user.id, entity: 'User', entityId: newUser.id,
      details: { username },
      ipAddress: getIp(req)
    });

    res.redirect('/admin/users');
  } catch (err) {
    log.error({ err }, 'createUser error');
    res.render('error', { message: 'Failed to create user: ' + err.message });
  }
}

// Edit user
export async function editUser(req, res) {
  try {
    const user = await db.User.findByPk(req.params.id);
    if (!user) {
      return res.render('error', { message: 'User not found' });
    }

    const { isActive, esimLimit, isAdmin } = req.body;
    const changes = {
      isActive: isActive === 'true' || isActive === 'on',
      esimLimit: esimLimit ? parseInt(esimLimit) : null,
      isAdmin: isAdmin === 'true' || isAdmin === 'on'
    };
    await user.update(changes);

    await logAudit(ACTIONS.USER_EDIT, {
      userId: req.session.user.id, entity: 'User', entityId: user.id,
      details: { username: user.username, changes },
      ipAddress: getIp(req)
    });

    res.redirect('/admin/users');
  } catch (err) {
    log.error({ err }, 'editUser error');
    res.render('error', { message: 'Failed to update user' });
  }
}

// Show assign eSIM form
export async function showAssignEsim(req, res) {
  try {
    const users = await db.User.findAll({
      where: { isActive: true },
      attributes: ['id', 'username', 'displayName', 'esimLimit'],
      include: [{ model: db.Esim, foreignKey: 'userId', attributes: ['id'] }],
      order: [['username', 'ASC']]
    });

    const country = process.env.COUNTRY || 'TR';
    const packages = await db.AiraloPackage.findAll({
      where: { countryCode: country },
      order: [['price', 'ASC']],
      limit: 100,
    });

    const errors = req.session.validationErrors || [];
    const success = req.session.assignSuccess || null;
    delete req.session.validationErrors;
    delete req.session.assignSuccess;

    res.render('admin/assign-esim', {
      title: 'Assign eSIM',
      users,
      offers: packages,
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showAssignEsim error');
    res.render('error', { message: 'Failed to load assign form' });
  }
}

// Assign eSIM to user (Airalo)
export async function assignEsim(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    const { userId, packageId } = req.body;
    const adminId = req.session.user.id;

    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      transaction
    });

    if (!user) {
      await transaction.rollback();
      req.session.validationErrors = ['User not found'];
      return res.redirect('/admin/assign-esim');
    }

    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      req.session.validationErrors = [`User ${user.username} has reached their eSIM limit (${user.esimLimit})`];
      return res.redirect('/admin/assign-esim');
    }

    log.info({ username: user.username, packageId }, 'Admin assigning Airalo eSIM');

    const orderResult = await airaloCreateOrder(packageId, 1, `Admin assign to ${user.username}`);
    const order = orderResult?.data || orderResult;
    const sim = order.sims?.[0] || {};

    const esim = await db.Esim.create({
      userId: user.id,
      offerId: packageId,
      transactionId: String(order.id || order.code),
      status: 'completed',
      vendor: 'airalo',
      vendorOrderId: String(order.id),
      assignedBy: adminId,
      iccid: sim.iccid || null,
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
      }
    }, { transaction });

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_ASSIGN, {
      userId: adminId, entity: 'Esim', entityId: esim.id,
      details: { targetUser: user.username, packageId, airaloOrderId: order.id },
      ipAddress: getIp(req)
    });

    if (user.email) {
      await sendEsimAssignedEmail(user, esim);
    }

    req.session.assignSuccess = `eSIM assigned to ${user.username} successfully!`;
    res.redirect('/admin/assign-esim');
  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'assignEsim error');
    req.session.validationErrors = ['Failed to assign eSIM: ' + (err.response?.data?.message || err.message)];
    res.redirect('/admin/assign-esim');
  }
}

// Show top-up form
export async function showTopup(req, res) {
  try {
    const esim = await db.Esim.findByPk(req.params.esimId, {
      include: [
        { model: db.User, as: 'owner', attributes: ['id', 'username', 'displayName'] },
        { model: db.Esim, as: 'topups' }
      ]
    });

    if (!esim) {
      return res.render('error', { message: 'eSIM not found' });
    }

    let offers = [];
    let activePlans = null;

    if (esim.vendor === 'airalo' && esim.iccid) {
      try {
        const { getTopupPackages } = await import('../services/airaloClient.js');
        const topupResult = await getTopupPackages(esim.iccid);
        offers = topupResult?.data || [];
      } catch (e) {
        log.warn({ err: e.message, iccid: esim.iccid }, 'Could not fetch Airalo top-up packages');
      }
      try {
        const usageRes = await airaloGetUsage(esim.iccid);
        activePlans = usageRes?.data || null;
      } catch (e) { /* skip */ }
    } else if (esim.vendor === 'zendit') {
      const country = esim.country || process.env.COUNTRY || 'TR';
      let zenditOffers = cacheService.getOffers(country);
      if (!zenditOffers) {
        zenditOffers = await listOffers(country);
        cacheService.setOffers(country, zenditOffers);
      }
      offers = zenditOffers.list.filter(o => o.enabled);
      if (esim.iccid) {
        try { activePlans = await getEsimPlans(esim.iccid); } catch (e) { /* skip */ }
      }
    }

    const errors = req.session.validationErrors || [];
    const success = req.session.topupSuccess || null;
    delete req.session.validationErrors;
    delete req.session.topupSuccess;

    res.render('admin/topup', {
      title: 'Top-up eSIM',
      esim,
      offers,
      activePlans,
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showTopup error');
    res.render('error', { message: 'Failed to load top-up form' });
  }
}

// Top-up existing eSIM
export async function topupEsim(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    const esim = await db.Esim.findByPk(req.params.esimId, { transaction });

    if (!esim || !esim.iccid) {
      await transaction.rollback();
      req.session.validationErrors = ['eSIM not found or ICCID not available'];
      return res.redirect(`/admin/topup/${req.params.esimId}`);
    }

    if (esim.vendor === 'airalo') {
      const { packageId } = req.body;
      log.info({ iccid: esim.iccid, packageId }, 'Airalo top-up');

      const { createTopup } = await import('../services/airaloClient.js');
      const topupResult = await createTopup(packageId, esim.iccid, 'Admin topup');
      const order = topupResult?.data || topupResult;

      await db.Esim.create({
        userId: esim.userId,
        offerId: packageId,
        transactionId: String(order.id || order.code),
        status: 'completed',
        vendor: 'airalo',
        vendorOrderId: String(order.id),
        assignedBy: req.session.user.id,
        iccid: esim.iccid,
        parentEsimId: esim.id,
        dataGB: order.data ? parseFloat(order.data) || null : null,
        durationDays: order.validity || null,
        brandName: order.package || null,
        priceAmount: order.price || null,
        priceCurrency: order.currency || 'USD',
        vendorData: { topup: true }
      }, { transaction });

    } else {
      // Zendit top-up (legacy)
      const { offerId } = req.body;
      const transactionId = uuidv4();
      log.info({ iccid: esim.iccid, offerId, transactionId }, 'Zendit top-up');

      const purchase = await zenditPurchaseEsim(offerId, transactionId, esim.iccid);
      const confirmation = purchase.confirmation || {};

      await db.Esim.create({
        userId: esim.userId,
        offerId,
        transactionId,
        status: normalizeStatus(purchase.status),
        vendor: 'zendit',
        assignedBy: req.session.user.id,
        iccid: esim.iccid,
        parentEsimId: esim.id,
        country: purchase.country || esim.country,
        dataGB: purchase.dataGB || null,
        durationDays: purchase.durationDays || null,
        brandName: purchase.brandName || null,
        priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
        priceCurrency: purchase.price?.currency || null
      }, { transaction });
    }

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_TOPUP, {
      userId: req.session.user.id, entity: 'Esim', entityId: esim.id,
      details: { iccid: esim.iccid, vendor: esim.vendor },
      ipAddress: getIp(req)
    });

    req.session.topupSuccess = 'Top-up completed successfully!';
    res.redirect(`/admin/topup/${req.params.esimId}`);
  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'topupEsim error');
    req.session.validationErrors = ['Top-up failed: ' + (err.response?.data?.message || err.message)];
    res.redirect(`/admin/topup/${req.params.esimId}`);
  }
}

// Show all eSIMs
export async function showAllEsims(req, res) {
  try {
    const { page, limit, offset } = getPaginationParams(req);
    const { Op } = db.Sequelize;
    const search = req.query.search || '';
    const statusFilter = req.query.status || '';
    const where = { parentEsimId: null };

    if (search) {
      where[Op.or] = [
        { iccid: { [Op.iLike]: `%${search}%` } },
        { transactionId: { [Op.iLike]: `%${search}%` } },
        { offerId: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (statusFilter) {
      where.status = statusFilter;
    }

    const { count, rows: esims } = await db.Esim.findAndCountAll({
      include: [
        { model: db.User, as: 'owner', attributes: ['id', 'username', 'displayName'] },
        { model: db.User, as: 'assigner', attributes: ['id', 'username'] }
      ],
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true
    });
    const pagination = buildPagination(page, limit, count, req.query);
    res.render('admin/esims', { title: 'All eSIMs', esims, pagination, search, statusFilter });
  } catch (err) {
    log.error({ err }, 'showAllEsims error');
    res.render('error', { message: 'Failed to load eSIMs' });
  }
}

// List all payments (admin)
export async function listPayments(req, res) {
  try {
    const { page, limit, offset } = getPaginationParams(req);
    const { Op } = db.Sequelize;
    const search = req.query.search || '';
    const statusFilter = req.query.status || '';
    const esimFailed = req.query.esimFailed === '1';
    const where = {};

    if (search) {
      where[Op.or] = [
        { merchantOid: { [Op.iLike]: `%${search}%` } },
        { offerId: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (statusFilter) {
      where.status = statusFilter;
    }

    if (esimFailed) {
      where.metadata = { esimPurchaseFailed: true };
    }

    const { count, rows: payments } = await db.Payment.findAndCountAll({
      include: [
        { model: db.User, attributes: ['id', 'username', 'displayName'] },
        { model: db.Esim, attributes: ['id', 'transactionId', 'iccid', 'status'] }
      ],
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true
    });

    const pagination = buildPagination(page, limit, count, req.query);

    // Stats
    const totalAll = await db.Payment.count();
    const totalCompleted = await db.Payment.count({ where: { status: 'completed' } });
    const totalFailed = await db.Payment.count({ where: { status: 'failed' } });
    const totalEsimFailed = await db.Payment.count({ where: { metadata: { esimPurchaseFailed: true } } });

    res.render('admin/payments', {
      title: 'Admin Payments',
      payments,
      pagination,
      search,
      statusFilter,
      esimFailed,
      paymentStats: { totalAll, totalCompleted, totalFailed, totalEsimFailed }
    });
  } catch (err) {
    log.error({ err }, 'listPayments error');
    res.render('error', { message: 'Failed to load payments' });
  }
}

// Retry eSIM purchase for a completed payment
export async function retryEsimPurchase(req, res) {
  try {
    const payment = await db.Payment.findByPk(req.params.id);
    if (!payment) {
      return res.render('error', { message: 'Payment not found' });
    }

    if (payment.status !== 'completed') {
      return res.render('error', { message: 'Only completed payments can be retried' });
    }

    if (payment.esimId && !payment.metadata?.esimPurchaseFailed) {
      return res.render('error', { message: 'eSIM already purchased for this payment' });
    }

    try {
      let esim;
      if (payment.type === 'topup' && payment.targetIccid) {
        esim = await topupEsimAfterPayment(payment);
      } else {
        esim = await purchaseEsimAfterPayment(payment);
      }

      // Clear the failure flag
      await payment.update({
        metadata: { ...payment.metadata, esimPurchaseFailed: false, esimPurchaseError: null }
      });

      await logAudit(ACTIONS.PAYMENT_RETRY, {
        userId: req.session.user.id,
        entity: 'Payment',
        entityId: payment.id,
        details: { merchantOid: payment.merchantOid, esimId: esim.id, result: 'success' },
        ipAddress: getIp(req)
      });
    } catch (retryErr) {
      await payment.update({
        metadata: { ...payment.metadata, esimPurchaseError: retryErr.message, esimPurchaseFailed: true }
      });

      await logAudit(ACTIONS.PAYMENT_RETRY, {
        userId: req.session.user.id,
        entity: 'Payment',
        entityId: payment.id,
        details: { merchantOid: payment.merchantOid, result: 'failed', error: retryErr.message },
        ipAddress: getIp(req)
      });
    }

    res.redirect('/admin/payments');
  } catch (err) {
    log.error({ err }, 'retryEsimPurchase error');
    res.render('error', { message: 'Failed to retry eSIM purchase' });
  }
}

// Resolve a payment issue manually
export async function resolvePayment(req, res) {
  try {
    const payment = await db.Payment.findByPk(req.params.id);
    if (!payment) {
      return res.render('error', { message: 'Payment not found' });
    }

    await payment.update({
      resolvedAt: new Date(),
      resolvedBy: req.session.user.id,
      resolutionNote: req.body.resolutionNote || '',
      metadata: { ...payment.metadata, esimPurchaseFailed: false }
    });

    await logAudit(ACTIONS.PAYMENT_RESOLVED, {
      userId: req.session.user.id,
      entity: 'Payment',
      entityId: payment.id,
      details: { merchantOid: payment.merchantOid, note: req.body.resolutionNote },
      ipAddress: getIp(req)
    });

    res.redirect('/admin/payments');
  } catch (err) {
    log.error({ err }, 'resolvePayment error');
    res.render('error', { message: 'Failed to resolve payment' });
  }
}

// Cancel a pending payment (local + provider)
export async function cancelPayment(req, res) {
  try {
    const payment = await db.Payment.findByPk(req.params.id);
    if (!payment) {
      return res.render('error', { message: 'Payment not found' });
    }

    if (payment.status !== 'pending') {
      return res.render('error', { message: 'Only pending payments can be cancelled' });
    }

    // Cancel on provider side
    const providerResult = await cancelOnProvider(payment);

    await payment.update({
      status: 'cancelled',
      metadata: {
        ...payment.metadata,
        cancelledAt: new Date().toISOString(),
        cancelReason: 'admin_manual',
        cancelledBy: req.session.user.id,
        providerCancelResult: providerResult
      }
    });

    await logAudit(ACTIONS.PAYMENT_RESOLVED, {
      userId: req.session.user.id,
      entity: 'Payment',
      entityId: payment.id,
      details: { merchantOid: payment.merchantOid, action: 'cancelled', providerResult, note: req.body.cancelNote || '' },
      ipAddress: getIp(req)
    });

    res.redirect('/admin/payments');
  } catch (err) {
    log.error({ err }, 'cancelPayment error');
    res.render('error', { message: 'Failed to cancel payment' });
  }
}

// Cancel payment on Paddle/TurInvoice
async function cancelOnProvider(payment) {
  const provider = payment.provider;
  const txId = payment.providerTransactionId;

  if (!provider || provider === 'pending' || !txId) return 'no_provider';

  if (provider === 'paddle') {
    try {
      const env = process.env.PADDLE_ENVIRONMENT || 'sandbox';
      const apiBase = env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
      const apiKey = process.env.PADDLE_API_KEY;
      if (!apiKey) return 'no_api_key';

      const res = await fetch(`${apiBase}/transactions/${txId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'canceled' })
      });
      if (res.ok) {
        log.info({ paymentId: payment.id, txId }, 'Paddle transaction cancelled via admin');
        return 'cancelled';
      }
      const err = await res.json().catch(() => ({}));
      log.warn({ paymentId: payment.id, txId, status: res.status, error: err }, 'Paddle cancel failed');
      return `paddle_error_${res.status}`;
    } catch (err) {
      log.error({ err, paymentId: payment.id }, 'Paddle cancel exception');
      return 'paddle_exception';
    }
  }

  if (provider === 'turinvoice') {
    try {
      const idOrder = payment.metadata?.turInvoiceIdOrder;
      if (!idOrder) return 'no_order_id';

      const { cancelOrder, isInitialized } = await import('../services/turInvoiceClient.js');
      if (!isInitialized()) return 'not_initialized';

      await cancelOrder(idOrder);
      log.info({ paymentId: payment.id, idOrder }, 'TurInvoice order cancelled via admin');
      return 'cancelled';
    } catch (err) {
      log.error({ err, paymentId: payment.id }, 'TurInvoice cancel exception');
      return 'turinvoice_exception';
    }
  }

  return 'unknown_provider';
}

// Show eSIM detail
export async function showEsimDetail(req, res) {
  try {
    const esim = await db.Esim.findByPk(req.params.id, {
      include: [
        { model: db.User, as: 'owner', attributes: ['id', 'username', 'displayName', 'email'] },
        { model: db.User, as: 'assigner', attributes: ['id', 'username'] },
        { model: db.Esim, as: 'topups', order: [['createdAt', 'DESC']] }
      ]
    });

    if (!esim) {
      return res.render('error', { message: 'eSIM not found' });
    }

    let usage = null;
    let activePlans = null;

    if (esim.vendor === 'airalo' && esim.iccid) {
      try {
        const usageRes = await airaloGetUsage(esim.iccid);
        usage = usageRes?.data || null;
      } catch (e) {
        log.warn({ err: e.message, iccid: esim.iccid }, 'Could not fetch Airalo usage');
      }
    } else if (esim.vendor === 'zendit' || !esim.vendor) {
      try {
        usage = await zenditGetUsage(esim.transactionId);
      } catch (e) {
        log.warn({ err: e.message, transactionId: esim.transactionId }, 'Could not fetch Zendit usage');
      }
      if (esim.iccid) {
        try { activePlans = await getEsimPlans(esim.iccid); } catch (e) { /* skip */ }
      }
    }

    res.render('admin/esim-detail', { title: 'eSIM Detail', esim, usage, activePlans });
  } catch (err) {
    log.error({ err }, 'showEsimDetail error');
    res.render('error', { message: 'Failed to load eSIM detail' });
  }
}

// List emails (admin)
export async function listEmails(req, res) {
  try {
    const { page, limit, offset } = getPaginationParams(req);
    const { Op } = db.Sequelize;
    const search = req.query.search || '';
    const typeFilter = req.query.type || '';
    const statusFilter = req.query.status || '';
    const where = {};

    if (search) {
      where[Op.or] = [
        { to: { [Op.iLike]: `%${search}%` } },
        { subject: { [Op.iLike]: `%${search}%` } }
      ];
    }
    if (typeFilter) where.type = typeFilter;
    if (statusFilter) where.status = statusFilter;

    const { count, rows: emails } = await db.EmailLog.findAndCountAll({
      where,
      include: [{ model: db.User, as: 'user', attributes: ['id', 'username', 'displayName'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true
    });

    const pagination = buildPagination(page, limit, count, req.query);

    // Stats
    const totalAll = await db.EmailLog.count();
    const totalInbound = await db.EmailLog.count({ where: { type: 'inbound' } });
    const totalSent = await db.EmailLog.count({ where: { status: 'sent' } });
    const totalDelivered = await db.EmailLog.count({ where: { status: 'delivered' } });
    const totalBounced = await db.EmailLog.count({ where: { status: 'bounced' } });

    res.render('admin/emails', {
      title: 'Emails',
      emails,
      pagination,
      search,
      typeFilter,
      statusFilter,
      stats: { totalAll, totalInbound, totalSent, totalDelivered, totalBounced }
    });
  } catch (err) {
    log.error({ err }, 'listEmails error');
    res.render('error', { message: 'Failed to load emails' });
  }
}

// Show single email detail
export async function showEmailDetail(req, res) {
  try {
    const email = await db.EmailLog.findByPk(req.params.id, {
      include: [{ model: db.User, as: 'user', attributes: ['id', 'username', 'displayName', 'email'] }]
    });
    if (!email) return res.render('error', { message: 'Email not found' });

    // If inbound email has no body, try fetching from Resend API
    if (email.type === 'inbound' && email.resendId && email.metadata && !email.metadata.htmlBody && !email.metadata.textBody && !email.metadata.body) {
      try {
        const axios = (await import('axios')).default;
        const apiKey = process.env.RESEND_API_KEY;
        if (apiKey) {
          const resp = await axios.get(`https://api.resend.com/emails/receiving/${email.resendId}`, {
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          if (resp.data) {
            const updates = {
              metadata: {
                ...email.metadata,
                htmlBody: resp.data.html || null,
                textBody: resp.data.text || null,
                attachments: resp.data.attachments || email.metadata.attachments || [],
                rawDownloadUrl: resp.data.raw?.download_url || null,
                rawExpiresAt: resp.data.raw?.expires_at || null
              }
            };
            await email.update(updates);
            log.info({ emailId: email.resendId }, 'Fetched missing inbound email body');
          }
        }
      } catch (e) {
        log.warn({ err: e.message, emailId: email.resendId }, 'Could not fetch inbound email body on detail view');
      }
    }

    res.render('admin/email-detail', {
      title: 'Email Detail',
      email,
      replied: req.query.replied === 'true',
      error: req.query.error || null
    });
  } catch (err) {
    log.error({ err }, 'showEmailDetail error');
    res.render('error', { message: 'Failed to load email detail' });
  }
}

// Download individual attachment from inbound email
export async function downloadAttachment(req, res) {
  try {
    const email = await db.EmailLog.findByPk(req.params.id);
    if (!email || email.type !== 'inbound') {
      return res.render('error', { message: 'Email not found' });
    }

    const attachmentIndex = parseInt(req.params.attachmentIndex);
    if (isNaN(attachmentIndex)) {
      return res.render('error', { message: 'Invalid attachment' });
    }

    let rawUrl = email.metadata?.rawDownloadUrl;
    const rawExpiresAt = email.metadata?.rawExpiresAt;
    const isExpired = !rawUrl || (rawExpiresAt && new Date(rawExpiresAt) < new Date());

    if (isExpired) {
      // URL missing or expired — fetch fresh from Resend API
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey || !email.resendId) {
        return res.render('error', { message: 'Raw email not available' });
      }
      const axios = (await import('axios')).default;
      const resp = await axios.get(`https://api.resend.com/emails/receiving/${email.resendId}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!resp.data?.raw?.download_url) {
        return res.render('error', { message: 'Raw email not available' });
      }
      // Save for future use
      await email.update({
        metadata: { ...email.metadata, rawDownloadUrl: resp.data.raw.download_url, rawExpiresAt: resp.data.raw.expires_at }
      });
      return await parseAndServeAttachment(res, resp.data.raw.download_url, attachmentIndex);
    }

    return await parseAndServeAttachment(res, rawUrl, attachmentIndex);
  } catch (err) {
    log.error({ err }, 'downloadAttachment error');
    res.render('error', { message: 'Failed to download attachment' });
  }
}

async function parseAndServeAttachment(res, rawUrl, attachmentIndex) {
  const axios = (await import('axios')).default;
  const { simpleParser } = await import('mailparser');

  // Download raw email
  const rawResp = await axios.get(rawUrl, { responseType: 'arraybuffer' });
  const parsed = await simpleParser(Buffer.from(rawResp.data));

  if (!parsed.attachments || attachmentIndex >= parsed.attachments.length) {
    return res.render('error', { message: 'Attachment not found' });
  }

  const att = parsed.attachments[attachmentIndex];
  res.set({
    'Content-Type': att.contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${att.filename || 'attachment'}"`,
    'Content-Length': att.size || att.content.length
  });
  res.send(att.content);
}

/// Reply to inbound email
export async function replyToEmail(req, res) {
  try {
    const email = await db.EmailLog.findByPk(req.params.id);
    if (!email || email.type !== 'inbound') {
      return res.render('error', { title: 'Error', user: req.session.user, message: 'Email not found' });
    }

    const { replyBody } = req.body;
    if (!replyBody || !replyBody.trim()) {
      return res.redirect(`/admin/emails/${email.id}?error=empty`);
    }

    const replyTo = email.metadata?.from || email.to;
    const subject = email.subject?.startsWith('Re: ') ? email.subject : `Re: ${email.subject}`;

    // Reply from the address the original mail was sent to
    const originalTo = email.to?.split(',')[0]?.trim();

    const { sendReplyEmail } = await import('../services/emailService.js');
    await sendReplyEmail(replyTo, subject,
      `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;">
        ${replyBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>')}
        <br><br>
        <div style="border-left:3px solid #e2e8f0;padding-left:12px;color:#64748b;margin-top:16px;">
          <p style="margin:0 0 4px;font-size:12px;"><strong>${email.metadata?.from || 'Unknown'}</strong> wrote:</p>
          <div style="font-size:13px;">${email.metadata?.textBody || email.metadata?.htmlBody || '(no content)'}</div>
        </div>
      </div>`,
      { inReplyTo: email.resendId, userId: req.session.user.id, fromAddress: originalTo }
    );

    await logAudit(ACTIONS.ADMIN_EMAIL_REPLY || 'admin.email_reply', {
      userId: req.session.user.id,
      entity: 'EmailLog',
      entityId: email.id,
      details: { replyTo, subject },
      ipAddress: getIp(req)
    });

    res.redirect(`/admin/emails/${email.id}?replied=true`);
  } catch (err) {
    log.error({ err }, 'replyToEmail error');
    res.render('error', { title: 'Error', user: req.session.user, message: 'Failed to send reply' });
  }
}

// Admin-only: Zendit purchase page (for consuming remaining balance)
export async function showZenditPurchase(req, res) {
  try {
    const users = await db.User.findAll({
      where: { isActive: true },
      attributes: ['id', 'username', 'displayName', 'esimLimit'],
      include: [{ model: db.Esim, foreignKey: 'userId', attributes: ['id'] }],
      order: [['username', 'ASC']]
    });

    const country = process.env.COUNTRY || 'TR';
    let offers = cacheService.getOffers(country);
    if (!offers) {
      offers = await listOffers(country);
      cacheService.setOffers(country, offers);
    }
    const activeOffers = offers.list.filter(o => o.enabled);

    let balance = null;
    try {
      const bal = await zenditGetBalance();
      balance = {
        amount: (bal.availableBalance / (bal.currencyDivisor || 100)).toFixed(2),
        currency: bal.currency || 'USD'
      };
    } catch (e) {
      log.warn({ err: e.message }, 'Could not fetch Zendit balance');
    }

    const errors = req.session.validationErrors || [];
    const success = req.session.zenditSuccess || null;
    delete req.session.validationErrors;
    delete req.session.zenditSuccess;

    res.render('admin/zendit-purchase', {
      title: 'Zendit Purchase',
      users,
      offers: activeOffers,
      balance,
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showZenditPurchase error');
    res.render('error', { message: 'Failed to load Zendit purchase form' });
  }
}

export async function zenditPurchase(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    const { userId, offerId } = req.body;
    const adminId = req.session.user.id;

    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      transaction
    });

    if (!user) {
      await transaction.rollback();
      req.session.validationErrors = ['User not found'];
      return res.redirect('/admin/zendit/purchase');
    }

    const transactionId = uuidv4();
    log.info({ username: user.username, offerId, transactionId }, 'Admin Zendit purchase');

    const purchase = await zenditPurchaseEsim(offerId, transactionId);
    const confirmation = purchase.confirmation || {};

    await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: normalizeStatus(purchase.status),
      vendor: 'zendit',
      assignedBy: adminId,
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
      userId: adminId, entity: 'Esim', entityId: null,
      details: { offerId, transactionId, vendor: 'zendit', targetUser: user.username },
      ipAddress: getIp(req)
    });

    req.session.zenditSuccess = `Zendit eSIM purchased for ${user.username}!`;
    res.redirect('/admin/zendit/purchase');
  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'zenditPurchase error');
    req.session.validationErrors = ['Zendit purchase failed: ' + (err.response?.data?.message || err.message)];
    res.redirect('/admin/zendit/purchase');
  }
}

// --- Agency Management ---
export async function listAgencies(req, res) {
  try {
    const agencies = await db.Agency.findAll({
      order: [['createdAt', 'DESC']],
      include: [{ model: db.AgencyContract, attributes: ['id', 'quantity', 'usedQuantity', 'status'] }]
    });
    res.render('admin/agencies', { title: 'Agencies', user: req.session.user, agencies });
  } catch (err) {
    log.error({ err }, 'listAgencies failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to load agencies.' });
  }
}

export async function showAgencyDetail(req, res) {
  try {
    const agency = await db.Agency.findByPk(req.params.id, {
      include: [
        { model: db.AgencyContract, include: [{ model: db.AiraloPackage, as: 'package' }] },
        { model: db.User, as: 'users', attributes: ['id', 'username', 'email', 'agencyRole', 'isActive'] }
      ]
    });
    if (!agency) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'Agency not found.' });

    const bookingStats = await db.TravelerBooking.count({ where: { agencyId: agency.id }, group: ['status'] });
    const packages = await db.AiraloPackage.findAll({ where: { type: 'sim' }, order: [['title', 'ASC']] });
    const availableUsers = await db.User.findAll({
      where: { agencyId: null, isAdmin: false, isActive: true },
      attributes: ['id', 'username', 'email'],
      order: [['username', 'ASC']]
    });
    res.render('admin/agency-detail', { title: agency.name, user: req.session.user, agency, bookingStats, packages, availableUsers });
  } catch (err) {
    log.error({ err }, 'showAgencyDetail failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to load agency details.' });
  }
}

export async function createAgency(req, res) {
  const { name, slug, contactEmail, contactName, phone } = req.body;
  try {
    const agency = await db.Agency.create({
      name, slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, ''),
      contactEmail, contactName, phone: phone || null, status: 'active'
    });
    await logAudit(ACTIONS.AGENCY_CREATE, { userId: req.session.user.id, entity: 'Agency', entityId: agency.id, details: { name, slug }, ipAddress: getIp(req) });
    res.redirect(`/admin/agencies/${agency.id}`);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.render('error', { title: 'Error', user: req.session.user, message: 'This slug is already in use.' });
    log.error({ err }, 'createAgency failed');
    res.render('error', { title: 'Error', user: req.session.user, message: 'Failed to create agency.' });
  }
}

export async function assignAgencyUser(req, res) {
  const agencyId = Number(req.params.id);
  const { userId, agencyRole } = req.body;
  try {
    const agency = await db.Agency.findByPk(agencyId);
    if (!agency) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'Agency not found.' });

    const targetUser = await db.User.findByPk(userId);
    if (!targetUser) return res.status(400).render('error', { title: 'Error', user: req.session.user, message: 'User not found.' });

    await targetUser.update({ agencyId, agencyRole: agencyRole || 'staff' });
    await logAudit(ACTIONS.USER_UPDATE, {
      userId: req.session.user.id, entity: 'User', entityId: targetUser.id,
      details: { action: 'agency_assign', agencyId, agencyRole: agencyRole || 'staff' },
      ipAddress: getIp(req)
    });
    res.redirect(`/admin/agencies/${agencyId}`);
  } catch (err) {
    log.error({ err }, 'assignAgencyUser failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to assign user.' });
  }
}

export async function removeAgencyUser(req, res) {
  const agencyId = Number(req.params.id);
  const userId = Number(req.params.userId);
  try {
    const targetUser = await db.User.findOne({ where: { id: userId, agencyId } });
    if (!targetUser) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'User not found.' });

    await targetUser.update({ agencyId: null, agencyRole: null });
    await logAudit(ACTIONS.USER_UPDATE, {
      userId: req.session.user.id, entity: 'User', entityId: targetUser.id,
      details: { action: 'agency_remove', previousAgencyId: agencyId },
      ipAddress: getIp(req)
    });
    res.redirect(`/admin/agencies/${agencyId}`);
  } catch (err) {
    log.error({ err }, 'removeAgencyUser failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to remove user.' });
  }
}

export async function createContract(req, res) {
  const agencyId = Number(req.params.id);
  const { airaloPackageId, quantity, unitPriceAmount, unitPriceCurrency, contractEndAt } = req.body;
  try {
    const agency = await db.Agency.findByPk(agencyId);
    if (!agency) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'Agency not found.' });
    const pkg = await db.AiraloPackage.findByPk(airaloPackageId);
    if (!pkg) return res.status(400).render('error', { title: 'Error', user: req.session.user, message: 'Package not found.' });

    const contract = await db.AgencyContract.create({
      agencyId, airaloPackageId: Number(airaloPackageId), quantity: Number(quantity), usedQuantity: 0,
      unitPriceAmount: Number(unitPriceAmount), unitPriceCurrency: unitPriceCurrency || 'USD',
      contractEndAt: new Date(contractEndAt), status: 'active'
    });
    await logAudit(ACTIONS.CONTRACT_CREATE, { userId: req.session.user.id, entity: 'AgencyContract', entityId: contract.id, details: { agencyId, packageId: pkg.packageId, quantity }, ipAddress: getIp(req) });
    res.redirect(`/admin/agencies/${agencyId}`);
  } catch (err) {
    log.error({ err }, 'createContract failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to create contract.' });
  }
}

export async function toggleAgencyStatus(req, res) {
  const agencyId = Number(req.params.id);
  try {
    const agency = await db.Agency.findByPk(agencyId);
    if (!agency) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'Agency not found.' });

    const newStatus = agency.status === 'active' ? 'suspended' : 'active';
    await agency.update({ status: newStatus });
    await logAudit(ACTIONS.AGENCY_EDIT, {
      userId: req.session.user.id, entity: 'Agency', entityId: agency.id,
      details: { action: 'status_toggle', from: agency.status, to: newStatus },
      ipAddress: getIp(req)
    });
    res.redirect(`/admin/agencies/${agencyId}`);
  } catch (err) {
    log.error({ err }, 'toggleAgencyStatus failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to change status.' });
  }
}

export async function updateAgency(req, res) {
  const agencyId = Number(req.params.id);
  const { name, contactEmail, contactName, phone } = req.body;
  try {
    const agency = await db.Agency.findByPk(agencyId);
    if (!agency) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'Agency not found.' });

    await agency.update({
      name: name || agency.name,
      contactEmail: contactEmail || agency.contactEmail,
      contactName: contactName || agency.contactName,
      phone: phone || null
    });
    await logAudit(ACTIONS.AGENCY_EDIT, {
      userId: req.session.user.id, entity: 'Agency', entityId: agency.id,
      details: { name, contactEmail, contactName }, ipAddress: getIp(req)
    });
    res.redirect(`/admin/agencies/${agencyId}`);
  } catch (err) {
    log.error({ err }, 'updateAgency failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to update agency.' });
  }
}

export async function deleteAgency(req, res) {
  const agencyId = Number(req.params.id);
  try {
    const agency = await db.Agency.findByPk(agencyId);
    if (!agency) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'Agency not found.' });

    // Unlink all users
    await db.User.update({ agencyId: null, agencyRole: null }, { where: { agencyId } });
    // Terminate active contracts
    await db.AgencyContract.update({ status: 'terminated' }, { where: { agencyId, status: 'active' } });
    // Delete agency
    await agency.destroy();

    await logAudit(ACTIONS.AGENCY_EDIT, {
      userId: req.session.user.id, entity: 'Agency', entityId: agencyId,
      details: { name: agency.name }, ipAddress: getIp(req)
    });
    res.redirect('/admin/agencies');
  } catch (err) {
    log.error({ err }, 'deleteAgency failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to delete agency.' });
  }
}

export async function terminateContract(req, res) {
  const agencyId = Number(req.params.id);
  const contractId = Number(req.params.contractId);
  try {
    const contract = await db.AgencyContract.findOne({ where: { id: contractId, agencyId } });
    if (!contract) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'Contract not found.' });

    await contract.update({ status: 'terminated' });
    await logAudit(ACTIONS.CONTRACT_EDIT, {
      userId: req.session.user.id, entity: 'AgencyContract', entityId: contractId,
      details: { action: 'terminate', agencyId }, ipAddress: getIp(req)
    });
    res.redirect(`/admin/agencies/${agencyId}`);
  } catch (err) {
    log.error({ err }, 'terminateContract failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to terminate contract.' });
  }
}

export async function updateAgencyUserRole(req, res) {
  const agencyId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const { agencyRole } = req.body;
  try {
    const targetUser = await db.User.findOne({ where: { id: userId, agencyId } });
    if (!targetUser) return res.status(404).render('error', { title: 'Error', user: req.session.user, message: 'User not found.' });

    const newRole = agencyRole === 'owner' ? 'owner' : 'staff';
    await targetUser.update({ agencyRole: newRole });
    await logAudit(ACTIONS.USER_UPDATE, {
      userId: req.session.user.id, entity: 'User', entityId: targetUser.id,
      details: { action: 'agency_role_change', agencyId, newRole }, ipAddress: getIp(req)
    });
    res.redirect(`/admin/agencies/${agencyId}`);
  } catch (err) {
    log.error({ err }, 'updateAgencyUserRole failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to change role.' });
  }
}

export async function listWebhookLogs(req, res) {
  try {
    const { status, page = 1 } = req.query;
    const limit = 50;
    const offset = (page - 1) * limit;
    const where = {};
    if (status && status !== 'all') where.processStatus = status;
    const { count, rows: logs } = await db.AiraloWebhookLog.findAndCountAll({
      where, include: [{ model: db.TravelerBooking, as: 'booking', attributes: ['id', 'travelerName', 'token'] }],
      order: [['receivedAt', 'DESC']], limit, offset
    });
    res.render('admin/webhook-logs', { title: 'Webhook Logs', user: req.session.user, logs, total: count, page: Number(page), totalPages: Math.ceil(count / limit), filter: status || 'all' });
  } catch (err) {
    log.error({ err }, 'listWebhookLogs failed');
    res.status(500).render('error', { title: 'Error', user: req.session.user, message: 'Failed to load webhook logs.' });
  }
}

export async function retryWebhook(req, res) {
  try {
    const { processWebhook } = await import('./webhookController.js');
    const webhookLog = await db.AiraloWebhookLog.findByPk(req.params.id);
    if (!webhookLog || webhookLog.processStatus === 'success') return res.redirect('/admin/webhook-logs');
    try {
      await webhookLog.update({ processStatus: 'retrying', retryCount: webhookLog.retryCount + 1 });
      await processWebhook(webhookLog);
      await logAudit(ACTIONS.WEBHOOK_RETRIED, { userId: req.session.user.id, entity: 'AiraloWebhookLog', entityId: webhookLog.id, ipAddress: getIp(req) });
    } catch (innerErr) {
      log.error({ err: innerErr, webhookLogId: webhookLog.id }, 'Manual webhook retry failed');
    }
    res.redirect('/admin/webhook-logs');
  } catch (err) {
    log.error({ err }, 'retryWebhook failed');
    res.redirect('/admin/webhook-logs');
  }
}
