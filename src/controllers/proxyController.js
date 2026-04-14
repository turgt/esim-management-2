import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'proxy' });

// GET /e/:token
export async function showProxyPage(req, res) {
  const { token } = req.params;

  try {
    const booking = await db.TravelerBooking.findOne({
      where: { token },
      include: [
        {
          model: db.Agency,
          attributes: ['id', 'name', 'slug', 'logoUrl', 'contactEmail', 'contactName', 'phone']
        },
        {
          model: db.AgencyContract,
          as: 'contract',
          include: [
            {
              model: db.AiraloPackage,
              as: 'package',
              attributes: ['title', 'countryCode', 'data', 'day', 'operatorTitle', 'imageUrl', 'isUnlimited', 'voice', 'text']
            }
          ]
        },
        {
          model: db.Esim,
          as: 'esim',
          attributes: ['id', 'iccid', 'smdpAddress', 'activationCode', 'status']
        }
      ]
    });

    if (!booking) {
      return res.status(404).render('proxy/page', {
        title: 'eSIM Not Found',
        state: 'not_found',
        booking: null,
        agency: null,
        package: null,
        esim: null
      });
    }

    const agency = booking.Agency || null;
    const pkg = booking.contract?.package || null;
    const esim = booking.esim || null;

    res.render('proxy/page', {
      title: agency ? `${agency.name} - eSIM` : 'eSIM',
      state: booking.status,
      booking: {
        id: booking.id,
        token: booking.token,
        travelerName: booking.travelerName,
        dueDate: booking.dueDate,
        status: booking.status,
        provisionedAt: booking.provisionedAt,
        changeCount: booking.changeCount
      },
      agency: agency ? {
        name: agency.name,
        logoUrl: agency.logoUrl,
        contactEmail: agency.contactEmail,
        contactName: agency.contactName,
        phone: agency.phone
      } : null,
      package: pkg ? {
        title: pkg.title,
        countryCode: pkg.countryCode,
        data: pkg.data,
        day: pkg.day,
        operatorTitle: pkg.operatorTitle,
        imageUrl: pkg.imageUrl,
        isUnlimited: pkg.isUnlimited,
        voice: pkg.voice,
        text: pkg.text
      } : null,
      esim: esim ? {
        iccid: esim.iccid,
        smdpAddress: esim.smdpAddress,
        activationCode: esim.activationCode,
        status: esim.status
      } : null
    });
  } catch (err) {
    log.error({ err, token }, 'showProxyPage failed');
    res.status(500).render('proxy/page', {
      title: 'Error',
      state: 'error',
      booking: null,
      agency: null,
      package: null,
      esim: null
    });
  }
}

// GET /api/booking-status/:token
export async function checkBookingStatus(req, res) {
  const { token } = req.params;

  try {
    const booking = await db.TravelerBooking.findOne({
      where: { token },
      attributes: ['status', 'provisionedAt']
    });

    if (!booking) {
      return res.status(404).json({ status: 'not_found' });
    }

    res.json({ status: booking.status, provisionedAt: booking.provisionedAt });
  } catch (err) {
    log.error({ err, token }, 'checkBookingStatus failed');
    res.status(500).json({ error: 'Internal server error' });
  }
}
