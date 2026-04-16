import db from '../db/models/index.js';
import { createBooking, cancelBooking, changeDueDate, BookingError } from '../services/bookingService.js';
import { getPaginationParams, buildPagination } from '../utils/pagination.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'agency' });

const APP_URL = process.env.APP_URL || 'https://datapatch.app';
const DATE_CHANGE_CUTOFF_HOURS = 72;

// GET /agency
export async function showDashboard(req, res) {
  try {
    const agencyId = req.session.user.agencyId;
    const { Op } = db.Sequelize;

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [
      totalContracts,
      activeContracts,
      totalBookings,
      activeBookings,
      thisWeekBookings,
      upcomingBookings
    ] = await Promise.all([
      db.AgencyContract.count({ where: { agencyId } }),
      db.AgencyContract.count({ where: { agencyId, status: 'active' } }),
      db.TravelerBooking.count({ where: { agencyId } }),
      db.TravelerBooking.count({ where: { agencyId, status: 'pending_provisioning' } }),
      db.TravelerBooking.count({
        where: {
          agencyId,
          createdAt: { [Op.gte]: startOfWeek }
        }
      }),
      db.TravelerBooking.findAll({
        where: {
          agencyId,
          status: 'pending_provisioning',
          dueDate: { [Op.between]: [now, sevenDaysLater] }
        },
        include: [
          {
            model: db.AgencyContract,
            as: 'contract',
            include: [{ model: db.AiraloPackage, as: 'package', attributes: ['title', 'countryCode', 'data', 'day'] }]
          }
        ],
        order: [['dueDate', 'ASC']],
        limit: 10
      })
    ]);

    res.render('agency/dashboard', {
      title: 'Agency Dashboard',
      user: req.session.user,
      stats: { totalContracts, activeContracts, totalBookings, activeBookings, thisWeekBookings },
      upcomingBookings
    });
  } catch (err) {
    log.error({ err }, 'showDashboard failed');
    res.status(500).render('error', { title: 'Error', message: 'Failed to load dashboard.', user: req.session.user });
  }
}

// GET /agency/bookings
export async function listBookings(req, res) {
  try {
    const agencyId = req.session.user.agencyId;
    const { Op } = db.Sequelize;
    const { page, limit, offset } = getPaginationParams(req);

    const status = req.query.status || '';
    const search = req.query.search || '';

    const where = { agencyId };
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { travelerName: { [Op.iLike]: `%${search}%` } },
        { travelerEmail: { [Op.iLike]: `%${search}%` } },
        { agencyBookingRef: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: bookings } = await db.TravelerBooking.findAndCountAll({
      where,
      include: [
        {
          model: db.AgencyContract,
          as: 'contract',
          include: [{ model: db.AiraloPackage, as: 'package', attributes: ['title', 'countryCode', 'data', 'day'] }]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const pagination = buildPagination(page, limit, count, req.query);

    res.render('agency/bookings', {
      title: 'Bookings',
      user: req.session.user,
      bookings,
      pagination,
      filters: { status, search }
    });
  } catch (err) {
    log.error({ err }, 'listBookings failed');
    res.status(500).render('error', { title: 'Error', message: 'Failed to load bookings.', user: req.session.user });
  }
}

// GET /agency/bookings/new
export async function showNewBookingForm(req, res) {
  try {
    const agencyId = req.session.user.agencyId;
    const now = new Date();

    const contracts = await db.AgencyContract.findAll({
      where: {
        agencyId,
        status: 'active',
        contractEndAt: { [db.Sequelize.Op.gt]: now }
      },
      include: [{ model: db.AiraloPackage, as: 'package', attributes: ['title', 'countryCode', 'data', 'day', 'operatorTitle'] }],
      order: [['createdAt', 'DESC']]
    });

    res.render('agency/new-booking', {
      title: 'New Booking',
      user: req.session.user,
      contracts,
      error: req.query.error || null
    });
  } catch (err) {
    log.error({ err }, 'showNewBookingForm failed');
    res.status(500).render('error', { title: 'Error', message: 'Failed to load form.', user: req.session.user });
  }
}

// POST /agency/bookings
export async function handleCreateBooking(req, res) {
  const agencyId = req.session.user.agencyId;
  const { contractId, travelerName, travelerEmail, travelerPhone, agencyBookingRef, dueDate } = req.body;

  try {
    const result = await createBooking(
      { contractId, travelerName, travelerEmail, travelerPhone, agencyBookingRef, dueDate, agencyId },
      req
    );
    res.redirect(`/agency/bookings/${result.bookingId}?created=true`);
  } catch (err) {
    if (err instanceof BookingError) {
      log.warn({ err, agencyId }, 'createBooking validation error');
      return res.redirect(`/agency/bookings/new?error=${encodeURIComponent(err.message)}`);
    }
    log.error({ err }, 'handleCreateBooking unexpected error');
    res.status(500).render('error', { title: 'Error', message: 'Failed to create booking.', user: req.session.user });
  }
}

// GET /agency/bookings/:id
export async function showBookingDetail(req, res) {
  try {
    const agencyId = req.session.user.agencyId;
    const bookingId = req.params.id;

    const booking = await db.TravelerBooking.findOne({
      where: { id: bookingId, agencyId },
      include: [
        {
          model: db.AgencyContract,
          as: 'contract',
          include: [
            { model: db.AiraloPackage, as: 'package' },
            { model: db.Agency }
          ]
        },
        { model: db.Esim, as: 'esim', attributes: ['id', 'iccid', 'smdpAddress', 'activationCode', 'status', 'vendorOrderId'] }
      ]
    });

    if (!booking) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Booking not found.', user: req.session.user });
    }

    const now = new Date();
    const cutoff = new Date(booking.dueDate.getTime() - DATE_CHANGE_CUTOFF_HOURS * 60 * 60 * 1000);

    const canChangeDate = booking.status === 'pending_provisioning' && now < cutoff;
    const canCancel = booking.status === 'pending_provisioning';
    const tokenUrl = `${APP_URL}/e/${booking.token}`;

    res.render('agency/booking-detail', {
      title: `Booking #${booking.id}`,
      user: req.session.user,
      booking,
      canChangeDate,
      canCancel,
      tokenUrl,
      created: req.query.created === 'true',
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    log.error({ err }, 'showBookingDetail failed');
    res.status(500).render('error', { title: 'Error', message: 'Failed to load booking details.', user: req.session.user });
  }
}

// POST /agency/bookings/:id/cancel
export async function handleCancelBooking(req, res) {
  const agencyId = req.session.user.agencyId;
  const bookingId = req.params.id;
  const { reason } = req.body;

  try {
    await cancelBooking(bookingId, agencyId, { reason, req });
    res.redirect(`/agency/bookings/${bookingId}?success=Booking+cancelled`);
  } catch (err) {
    if (err instanceof BookingError) {
      log.warn({ err, agencyId, bookingId }, 'cancelBooking validation error');
      return res.redirect(`/agency/bookings/${bookingId}?error=${encodeURIComponent(err.message)}`);
    }
    log.error({ err }, 'handleCancelBooking unexpected error');
    res.status(500).render('error', { title: 'Error', message: 'Cancellation failed.', user: req.session.user });
  }
}

// POST /agency/bookings/:id/change-date
export async function handleChangeDueDate(req, res) {
  const agencyId = req.session.user.agencyId;
  const bookingId = req.params.id;
  const { newDueDate } = req.body;

  try {
    await changeDueDate(bookingId, newDueDate, agencyId, req);
    res.redirect(`/agency/bookings/${bookingId}?success=Tarih+guncellendi`);
  } catch (err) {
    if (err instanceof BookingError) {
      log.warn({ err, agencyId, bookingId }, 'changeDueDate validation error');
      return res.redirect(`/agency/bookings/${bookingId}?error=${encodeURIComponent(err.message)}`);
    }
    log.error({ err }, 'handleChangeDueDate unexpected error');
    res.status(500).render('error', { title: 'Error', message: 'Date change failed.', user: req.session.user });
  }
}

// GET /agency/contracts
export async function listContracts(req, res) {
  try {
    const agencyId = req.session.user.agencyId;
    const { page, limit, offset } = getPaginationParams(req);

    const { count, rows: contracts } = await db.AgencyContract.findAndCountAll({
      where: { agencyId },
      include: [
        { model: db.AiraloPackage, as: 'package', attributes: ['title', 'countryCode', 'data', 'day', 'operatorTitle', 'imageUrl'] }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const pagination = buildPagination(page, limit, count, req.query);

    res.render('agency/contracts', {
      title: 'Contracts',
      user: req.session.user,
      contracts,
      pagination
    });
  } catch (err) {
    log.error({ err }, 'listContracts failed');
    res.status(500).render('error', { title: 'Error', message: 'Failed to load contracts.', user: req.session.user });
  }
}
