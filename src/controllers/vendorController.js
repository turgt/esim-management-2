import db from '../db/models/index.js';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { getPaginationParams, buildPagination } from '../utils/pagination.js';
import { logAudit, ACTIONS, getIp } from '../services/auditService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'vendor' });

function generateVendorCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// List all vendors
export async function listVendors(req, res) {
  try {
    const { page, limit, offset } = getPaginationParams(req);
    const { Op } = db.Sequelize;
    const search = req.query.search || '';
    const where = {};

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } },
        { contactInfo: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: vendors } = await db.Vendor.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true
    });

    // Get stats for each vendor
    const vendorStats = await Promise.all(vendors.map(async (vendor) => {
      const userCount = await db.User.count({ where: { vendorId: vendor.id } });
      const users = await db.User.findAll({
        where: { vendorId: vendor.id },
        attributes: ['id']
      });
      const userIds = users.map(u => u.id);

      let purchaseCount = 0;
      let totalRevenue = 0;
      if (userIds.length > 0) {
        purchaseCount = await db.Payment.count({
          where: { userId: { [Op.in]: userIds }, status: 'completed' }
        });
        totalRevenue = await db.Payment.sum('amount', {
          where: { userId: { [Op.in]: userIds }, status: 'completed' }
        }) || 0;
      }

      return {
        ...vendor.toJSON(),
        userCount,
        purchaseCount,
        totalRevenue,
        commission: totalRevenue * (parseFloat(vendor.commissionRate) / 100)
      };
    }));

    const pagination = buildPagination(page, limit, count, req.query);

    // Overall stats
    const totalVendors = await db.Vendor.count();
    const activeVendors = await db.Vendor.count({ where: { isActive: true } });
    const totalReferredUsers = await db.User.count({ where: { vendorId: { [db.Sequelize.Op.ne]: null } } });

    res.render('admin/vendors', {
      title: 'Vendors',
      vendors: vendorStats,
      pagination,
      search,
      stats: { totalVendors, activeVendors, totalReferredUsers }
    });
  } catch (err) {
    log.error({ err }, 'listVendors error');
    res.render('error', { message: 'Failed to load vendors' });
  }
}

// Show create vendor form
export async function showCreateVendor(req, res) {
  const errors = req.session.validationErrors || [];
  const success = req.session.vendorSuccess || null;
  delete req.session.validationErrors;
  delete req.session.vendorSuccess;

  const users = await db.User.findAll({
    where: { isActive: true },
    attributes: ['id', 'username', 'displayName'],
    order: [['username', 'ASC']]
  });

  res.render('admin/vendor-form', {
    title: 'Create Vendor',
    vendor: null,
    users,
    errors,
    success
  });
}

// Create vendor
export async function createVendor(req, res) {
  try {
    const { name, contactInfo, notes, commissionRate, userId } = req.body;

    if (!name || !name.trim()) {
      req.session.validationErrors = ['Vendor name is required'];
      return res.redirect('/admin/vendors/create');
    }

    const code = generateVendorCode();
    const managerUserId = userId ? parseInt(userId) : null;

    const vendor = await db.Vendor.create({
      name: name.trim(),
      code,
      commissionRate: parseFloat(commissionRate) || 0,
      contactInfo: contactInfo || null,
      notes: notes || null,
      isActive: true,
      userId: managerUserId
    });

    // Auto-set isVendor on assigned user
    if (managerUserId) {
      await db.User.update({ isVendor: true }, { where: { id: managerUserId } });
    }

    await logAudit(ACTIONS.VENDOR_CREATE, {
      userId: req.session.user.id,
      entity: 'Vendor',
      entityId: vendor.id,
      details: { name: vendor.name, code: vendor.code, managerUserId },
      ipAddress: getIp(req)
    });

    req.session.vendorSuccess = `Vendor "${vendor.name}" created with code: ${vendor.code}`;
    res.redirect(`/admin/vendors/${vendor.id}`);
  } catch (err) {
    log.error({ err }, 'createVendor error');
    req.session.validationErrors = ['Failed to create vendor: ' + err.message];
    res.redirect('/admin/vendors/create');
  }
}

// Show vendor detail with stats
export async function showVendorDetail(req, res) {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id, {
      include: [{ model: db.User, as: 'manager', attributes: ['id', 'username', 'displayName'] }]
    });
    if (!vendor) {
      return res.render('error', { message: 'Vendor not found' });
    }

    const { Op } = db.Sequelize;
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const refUrl = `${appUrl}/?ref=${vendor.code}`;

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(refUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#1e293b', light: '#ffffff' }
    });

    // User stats
    const totalUsers = await db.User.count({ where: { vendorId: vendor.id } });
    const activeUsers = await db.User.count({ where: { vendorId: vendor.id, isActive: true } });
    const inactiveUsers = totalUsers - activeUsers;

    // Get all referred user IDs
    const referredUsers = await db.User.findAll({
      where: { vendorId: vendor.id },
      attributes: ['id']
    });
    const userIds = referredUsers.map(u => u.id);

    // Purchase & revenue stats
    let totalPurchases = 0;
    let totalRevenue = 0;
    if (userIds.length > 0) {
      totalPurchases = await db.Payment.count({
        where: { userId: { [Op.in]: userIds }, status: 'completed' }
      });
      totalRevenue = await db.Payment.sum('amount', {
        where: { userId: { [Op.in]: userIds }, status: 'completed' }
      }) || 0;
    }

    const commission = totalRevenue * (parseFloat(vendor.commissionRate) / 100);

    // Recent users (last 10)
    const recentUsers = await db.User.findAll({
      where: { vendorId: vendor.id },
      order: [['createdAt', 'DESC']],
      limit: 10,
      attributes: ['id', 'username', 'displayName', 'email', 'isActive', 'createdAt']
    });

    // Date-based stats (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyRegistrations = await db.User.findAll({
      where: {
        vendorId: vendor.id,
        createdAt: { [Op.gte]: thirtyDaysAgo }
      },
      attributes: [
        [db.sequelize.fn('DATE', db.sequelize.col('User.createdAt')), 'date'],
        [db.sequelize.fn('COUNT', db.sequelize.col('User.id')), 'count']
      ],
      group: [db.sequelize.fn('DATE', db.sequelize.col('User.createdAt'))],
      order: [[db.sequelize.fn('DATE', db.sequelize.col('User.createdAt')), 'ASC']],
      raw: true
    });

    let dailyPurchases = [];
    if (userIds.length > 0) {
      dailyPurchases = await db.Payment.findAll({
        where: {
          userId: { [Op.in]: userIds },
          status: 'completed',
          createdAt: { [Op.gte]: thirtyDaysAgo }
        },
        attributes: [
          [db.sequelize.fn('DATE', db.sequelize.col('createdAt')), 'date'],
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
          [db.sequelize.fn('SUM', db.sequelize.col('amount')), 'revenue']
        ],
        group: [db.sequelize.fn('DATE', db.sequelize.col('createdAt'))],
        order: [[db.sequelize.fn('DATE', db.sequelize.col('createdAt')), 'ASC']],
        raw: true
      });
    }

    // Build chart data for last 30 days
    const chartData = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const reg = dailyRegistrations.find(r => r.date === dateStr);
      const pur = dailyPurchases.find(p => p.date === dateStr);
      chartData.push({
        date: dateStr,
        registrations: reg ? parseInt(reg.count) : 0,
        purchases: pur ? parseInt(pur.count) : 0,
        revenue: pur ? parseFloat(pur.revenue) : 0
      });
    }

    const errors = req.session.validationErrors || [];
    const success = req.session.vendorSuccess || null;
    delete req.session.validationErrors;
    delete req.session.vendorSuccess;

    res.render('admin/vendor-detail', {
      title: 'Vendor Detail',
      vendor,
      refUrl,
      qrDataUrl,
      stats: { totalUsers, activeUsers, inactiveUsers, totalPurchases, totalRevenue, commission },
      recentUsers,
      chartData: JSON.stringify(chartData),
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showVendorDetail error');
    res.render('error', { message: 'Failed to load vendor detail' });
  }
}

// Show edit vendor form
export async function showEditVendor(req, res) {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.render('error', { message: 'Vendor not found' });
    }

    const errors = req.session.validationErrors || [];
    delete req.session.validationErrors;

    const users = await db.User.findAll({
      where: { isActive: true },
      attributes: ['id', 'username', 'displayName'],
      order: [['username', 'ASC']]
    });

    res.render('admin/vendor-form', {
      title: 'Edit Vendor',
      vendor,
      users,
      errors,
      success: null
    });
  } catch (err) {
    log.error({ err }, 'showEditVendor error');
    res.render('error', { message: 'Failed to load vendor' });
  }
}

// Update vendor
export async function updateVendor(req, res) {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.render('error', { message: 'Vendor not found' });
    }

    const { name, contactInfo, notes, commissionRate, isActive, userId } = req.body;

    if (!name || !name.trim()) {
      req.session.validationErrors = ['Vendor name is required'];
      return res.redirect(`/admin/vendors/${vendor.id}/edit`);
    }

    const oldUserId = vendor.userId;
    const newUserId = userId ? parseInt(userId) : null;

    await vendor.update({
      name: name.trim(),
      commissionRate: parseFloat(commissionRate) || 0,
      contactInfo: contactInfo || null,
      notes: notes || null,
      isActive: isActive === 'true' || isActive === 'on',
      userId: newUserId
    });

    // Auto-toggle isVendor: remove from old user, add to new user
    if (oldUserId !== newUserId) {
      if (oldUserId) {
        // Check if old user manages any other vendor
        const otherVendor = await db.Vendor.findOne({ where: { userId: oldUserId, id: { [db.Sequelize.Op.ne]: vendor.id } } });
        if (!otherVendor) {
          await db.User.update({ isVendor: false }, { where: { id: oldUserId } });
        }
      }
      if (newUserId) {
        await db.User.update({ isVendor: true }, { where: { id: newUserId } });
      }
    }

    await logAudit(ACTIONS.VENDOR_EDIT, {
      userId: req.session.user.id,
      entity: 'Vendor',
      entityId: vendor.id,
      details: { name: vendor.name, managerUserId: newUserId },
      ipAddress: getIp(req)
    });

    req.session.vendorSuccess = 'Vendor updated successfully';
    res.redirect(`/admin/vendors/${vendor.id}`);
  } catch (err) {
    log.error({ err }, 'updateVendor error');
    req.session.validationErrors = ['Failed to update vendor: ' + err.message];
    res.redirect(`/admin/vendors/${req.params.id}/edit`);
  }
}

// Delete vendor
export async function deleteVendor(req, res) {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.render('error', { message: 'Vendor not found' });
    }

    // Remove isVendor from manager user
    if (vendor.userId) {
      await db.User.update({ isVendor: false }, { where: { id: vendor.userId } });
    }

    // Remove vendor reference from referred users (don't delete users)
    await db.User.update({ vendorId: null }, { where: { vendorId: vendor.id } });

    await vendor.destroy();

    await logAudit(ACTIONS.VENDOR_DELETE, {
      userId: req.session.user.id,
      entity: 'Vendor',
      entityId: vendor.id,
      details: { name: vendor.name, code: vendor.code },
      ipAddress: getIp(req)
    });

    res.redirect('/admin/vendors');
  } catch (err) {
    log.error({ err }, 'deleteVendor error');
    res.render('error', { message: 'Failed to delete vendor' });
  }
}

// Generate printable A6 brochure with vendor's QR code
export async function showVendorBrochure(req, res) {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor || !vendor.isActive) {
      return res.render('error', { message: 'Vendor not found or inactive.' });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const refUrl = `${appUrl}/?ref=${vendor.code}`;

    const qrDataUrl = await QRCode.toDataURL(refUrl, {
      width: 400,
      margin: 1,
      color: { dark: '#1c1917', light: '#ffffff' }
    });

    res.render('vendor/brochure', { qrDataUrl });
  } catch (err) {
    log.error({ err }, 'showVendorBrochure error');
    res.render('error', { message: 'Failed to generate brochure.' });
  }
}

// Download QR code as PNG
export async function downloadQrCode(req, res) {
  try {
    const vendor = await db.Vendor.findByPk(req.params.id);
    if (!vendor) {
      return res.render('error', { message: 'Vendor not found' });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const refUrl = `${appUrl}/?ref=${vendor.code}`;

    const buffer = await QRCode.toBuffer(refUrl, {
      width: 600,
      margin: 3,
      color: { dark: '#1e293b', light: '#ffffff' }
    });

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="vendor-${vendor.code}-qr.png"`
    });
    res.send(buffer);
  } catch (err) {
    log.error({ err }, 'downloadQrCode error');
    res.render('error', { message: 'Failed to generate QR code' });
  }
}
