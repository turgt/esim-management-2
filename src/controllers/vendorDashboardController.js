import db from '../db/models/index.js';
import QRCode from 'qrcode';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'vendor-dashboard' });

export async function showVendorDashboard(req, res) {
  try {
    const userId = req.session.user.id;
    const { Op } = db.Sequelize;

    const vendor = await db.Vendor.findOne({ where: { userId } });

    if (!vendor) {
      return res.render('vendor/dashboard', {
        title: 'Vendor Dashboard',
        inactive: true,
        message: 'No vendor account is linked to your user.'
      });
    }

    if (!vendor.isActive) {
      return res.render('vendor/dashboard', {
        title: 'Vendor Dashboard',
        inactive: true,
        message: 'Your vendor account is currently inactive. Please contact an administrator.'
      });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const refUrl = `${appUrl}/auth/register?ref=${vendor.code}`;

    const qrDataUrl = await QRCode.toDataURL(refUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#1e293b', light: '#ffffff' }
    });

    // User stats
    const totalUsers = await db.User.count({ where: { vendorId: vendor.id } });
    const activeUsers = await db.User.count({ where: { vendorId: vendor.id, isActive: true } });

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

    // Recent users (last 10) - only displayName and date for privacy
    const recentUsers = await db.User.findAll({
      where: { vendorId: vendor.id },
      order: [['createdAt', 'DESC']],
      limit: 10,
      attributes: ['id', 'displayName', 'username', 'createdAt']
    });

    // Recent sales (last 10)
    let recentSales = [];
    if (userIds.length > 0) {
      recentSales = await db.Payment.findAll({
        where: { userId: { [Op.in]: userIds }, status: 'completed' },
        order: [['createdAt', 'DESC']],
        limit: 10,
        include: [{ model: db.Esim, attributes: ['brandName', 'dataGB', 'country'] }],
        attributes: ['id', 'amount', 'currency', 'createdAt', 'offerId']
      });
    }

    // 30-day chart data
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

    res.render('vendor/dashboard', {
      title: 'Vendor Dashboard',
      inactive: false,
      vendor,
      refUrl,
      qrDataUrl,
      stats: { totalUsers, activeUsers, totalPurchases, totalRevenue, commission },
      recentUsers,
      recentSales: recentSales.map(s => ({
        id: s.id,
        amount: s.amount,
        currency: s.currency,
        createdAt: s.createdAt,
        planName: s.Esim ? `${s.Esim.brandName || ''} ${s.Esim.dataGB ? s.Esim.dataGB + 'GB' : ''} ${s.Esim.country || ''}`.trim() : (s.offerId || 'N/A'),
        commission: parseFloat(s.amount) * (parseFloat(vendor.commissionRate) / 100)
      })),
      chartData: JSON.stringify(chartData)
    });
  } catch (err) {
    log.error({ err }, 'showVendorDashboard error');
    res.render('error', { message: 'Failed to load vendor dashboard' });
  }
}
