import db from '../db/models/index.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { listOffers, purchaseEsim, getUsage, getBalance, getEsimPlans, normalizeStatus } from '../services/zenditClient.js';
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
      balance = await getBalance();
    } catch (e) {
      log.warn({ err: e }, 'Could not fetch balance');
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
    let offers = cacheService.getOffers(country);
    if (!offers) {
      offers = await listOffers(country);
      cacheService.setOffers(country, offers);
    }
    const activeOffers = offers.list.filter(o => o.enabled);

    const errors = req.session.validationErrors || [];
    const success = req.session.assignSuccess || null;
    delete req.session.validationErrors;
    delete req.session.assignSuccess;

    res.render('admin/assign-esim', {
      title: 'Assign eSIM',
      users,
      offers: activeOffers,
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showAssignEsim error');
    res.render('error', { message: 'Failed to load assign form' });
  }
}

// Assign eSIM to user
export async function assignEsim(req, res) {
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
      return res.redirect('/admin/assign-esim');
    }

    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      req.session.validationErrors = [`User ${user.username} has reached their eSIM limit (${user.esimLimit})`];
      return res.redirect('/admin/assign-esim');
    }

    const transactionId = uuidv4();
    log.info({ username: user.username, offerId, transactionId }, 'Admin assigning eSIM');

    const purchase = await purchaseEsim(offerId, transactionId);
    const confirmation = purchase.confirmation || {};

    const esim = await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: normalizeStatus(purchase.status),
      assignedBy: adminId,
      iccid: confirmation.iccid || null,
      smdpAddress: confirmation.smdpAddress || null,
      activationCode: confirmation.activationCode || null,
      country: purchase.country || process.env.COUNTRY || 'TR',
      dataGB: purchase.dataGB || null,
      durationDays: purchase.durationDays || null,
      brandName: purchase.brandName || null,
      priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
      priceCurrency: purchase.price?.currency || null
    }, { transaction });

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_ASSIGN, {
      userId: adminId, entity: 'Esim', entityId: esim.id,
      details: { targetUser: user.username, offerId, transactionId },
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

    const country = esim.country || process.env.COUNTRY || 'TR';
    let offers = cacheService.getOffers(country);
    if (!offers) {
      offers = await listOffers(country);
      cacheService.setOffers(country, offers);
    }
    const activeOffers = offers.list.filter(o => o.enabled);

    let activePlans = null;
    if (esim.iccid) {
      try {
        activePlans = await getEsimPlans(esim.iccid);
      } catch (e) {
        log.warn({ err: e, iccid: esim.iccid }, 'Could not fetch eSIM plans');
      }
    }

    const errors = req.session.validationErrors || [];
    const success = req.session.topupSuccess || null;
    delete req.session.validationErrors;
    delete req.session.topupSuccess;

    res.render('admin/topup', {
      title: 'Top-up eSIM',
      esim,
      offers: activeOffers,
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
    const { offerId } = req.body;
    const esim = await db.Esim.findByPk(req.params.esimId, { transaction });

    if (!esim || !esim.iccid) {
      await transaction.rollback();
      req.session.validationErrors = ['eSIM not found or ICCID not available'];
      return res.redirect(`/admin/topup/${req.params.esimId}`);
    }

    const transactionId = uuidv4();
    log.info({ iccid: esim.iccid, offerId, transactionId }, 'Top-up eSIM');

    const purchase = await purchaseEsim(offerId, transactionId, esim.iccid);
    const confirmation = purchase.confirmation || {};

    await db.Esim.create({
      userId: esim.userId,
      offerId,
      transactionId,
      status: normalizeStatus(purchase.status),
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

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_TOPUP, {
      userId: req.session.user.id, entity: 'Esim', entityId: esim.id,
      details: { iccid: esim.iccid, offerId, transactionId },
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
    try {
      usage = await getUsage(esim.transactionId);
    } catch (e) {
      log.warn({ err: e, transactionId: esim.transactionId }, 'Could not fetch usage');
    }

    let activePlans = null;
    if (esim.iccid) {
      try {
        activePlans = await getEsimPlans(esim.iccid);
      } catch (e) {
        log.warn({ err: e, iccid: esim.iccid }, 'Could not fetch eSIM plans');
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

    res.render('admin/email-detail', { title: 'Email Detail', email });
  } catch (err) {
    log.error({ err }, 'showEmailDetail error');
    res.render('error', { message: 'Failed to load email detail' });
  }
}
