import db from '../db/models/index.js';
import { generateBookingToken } from './tokenService.js';
import { submitFutureOrder, cancelOrder } from './futureOrderService.js';
import { logAudit, ACTIONS, getIp } from './auditService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'booking' });

const MIN_DUE_DATE_HOURS = 24;
const MAX_DUE_DATE_MONTHS = 12;
const DATE_CHANGE_CUTOFF_HOURS = 72;

export class BookingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'BookingError';
    this.statusCode = statusCode;
  }
}

export async function createBooking({ contractId, travelerName, travelerEmail, travelerPhone, agencyBookingRef, dueDate, agencyId }, req) {
  const transaction = await db.sequelize.transaction();

  try {
    // 1. Validate contract with lock
    const contract = await db.AgencyContract.findOne({
      where: { id: contractId, agencyId },
      include: [
        { model: db.AiraloPackage, as: 'package' },
        { model: db.Agency }
      ],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (!contract) throw new BookingError('Kontrat bulunamadi.', 404);
    if (contract.status !== 'active') throw new BookingError('Bu kontrat aktif degil.', 400);
    if (new Date(contract.contractEndAt) < new Date()) throw new BookingError('Kontrat suresi dolmus.', 400);
    if (contract.usedQuantity >= contract.quantity) throw new BookingError('Kontrat havuzu tukenmis.', 400);

    // 2. Validate due date
    const dueDateObj = new Date(dueDate);
    const now = new Date();
    const minDate = new Date(now.getTime() + MIN_DUE_DATE_HOURS * 60 * 60 * 1000);
    const maxDate = new Date(now);
    maxDate.setMonth(maxDate.getMonth() + MAX_DUE_DATE_MONTHS);

    if (dueDateObj <= minDate) throw new BookingError(`Seyahat tarihi en az ${MIN_DUE_DATE_HOURS} saat sonrasi olmalidir.`, 400);
    if (dueDateObj > maxDate) throw new BookingError(`Seyahat tarihi en fazla ${MAX_DUE_DATE_MONTHS} ay sonrasi olabilir.`, 400);

    // 3. Idempotency: check agency_booking_ref uniqueness or idempotency-key
    const idempotencyKey = req?.headers?.['idempotency-key'] || null;
    if (agencyBookingRef) {
      const existing = await db.TravelerBooking.findOne({
        where: { agencyId, agencyBookingRef },
        transaction
      });
      if (existing) throw new BookingError('Bu rezervasyon referansi zaten kullanilmis.', 409);
    } else if (idempotencyKey) {
      const existing = await db.TravelerBooking.findOne({
        where: {
          agencyId,
          travelerName,
          dueDate: dueDateObj,
          createdAt: { [db.Sequelize.Op.gte]: new Date(Date.now() - 5 * 60 * 1000) }
        },
        transaction
      });
      if (existing) throw new BookingError('Bu rezervasyon zaten olusturuldu (tekrar istek).', 409);
    }

    // 4. Call Airalo FutureOrder
    const token = generateBookingToken();
    const airaloRequestId = await submitFutureOrder({
      packageId: contract.package.packageId,
      dueDate: dueDateObj,
      agencySlug: contract.Agency.slug,
      bookingId: `tmp-${Date.now()}`
    });

    // 5. Create booking record
    const booking = await db.TravelerBooking.create({
      agencyId,
      agencyContractId: contractId,
      travelerName,
      travelerEmail: travelerEmail || null,
      travelerPhone: travelerPhone || null,
      agencyBookingRef: agencyBookingRef || null,
      token,
      dueDate: dueDateObj,
      originalDueDate: dueDateObj,
      status: 'pending_provisioning',
      airaloRequestId
    }, { transaction });

    // 6. Decrement pool
    await contract.increment('usedQuantity', { by: 1, transaction });
    if (contract.usedQuantity + 1 >= contract.quantity) {
      await contract.update({ status: 'exhausted' }, { transaction });
    }

    // 7. Audit
    await logAudit(ACTIONS.BOOKING_CREATE, {
      userId: req?.session?.user?.id,
      entity: 'TravelerBooking',
      entityId: booking.id,
      details: { contractId, packageId: contract.package.packageId, dueDate: dueDateObj.toISOString(), airaloRequestId, travelerName },
      ipAddress: req ? getIp(req) : null
    });

    await transaction.commit();

    // 8. Send confirmation email (non-blocking)
    const appUrl = process.env.APP_URL || 'https://datapatch.app';
    if (travelerEmail) {
      import('./emailService.js').then(({ sendMail, emailLayout, emailButton, emailInfoCard }) => {
        const dueDateStr = dueDateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
        const html = emailLayout(`
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">eSIM Rezervasyonu Olusturuldu</h2>
          <p style="color:#475569;font-size:15px;line-height:1.6;">Merhaba ${travelerName},</p>
          <p style="color:#475569;font-size:15px;line-height:1.6;">eSIM'iniz <strong>${dueDateStr}</strong> tarihinde hazir olacak.</p>
          ${emailInfoCard([
            { label: 'Tarih', value: dueDateStr },
            { label: 'Durum', value: 'Hazirlanıyor' },
          ])}
          <p style="color:#475569;font-size:15px;line-height:1.6;">Hazir oldugunda asagidaki linkten kurabilirsiniz:</p>
          ${emailButton(`${appUrl}/e/${token}`, 'eSIM\'i Kur')}
        `, { preheader: `eSIM'iniz ${dueDateStr} tarihinde hazir olacak` });
        sendMail(travelerEmail, 'eSIM Rezervasyonu - DataPatch', html, { type: 'booking_created', userId: null })
          .catch(err => log.error({ err }, 'Booking confirmation email failed'));
      });
    }

    return { bookingId: booking.id, token, tokenUrl: `${appUrl}/e/${token}`, status: booking.status, dueDate: booking.dueDate };
  } catch (err) {
    await transaction.rollback();
    if (err instanceof BookingError) throw err;
    log.error({ err }, 'createBooking failed');
    throw new BookingError('Rezervasyon olusturulamadi. Lutfen tekrar deneyin.', 500);
  }
}

export async function cancelBooking(bookingId, agencyId, { reason, req } = {}) {
  const transaction = await db.sequelize.transaction();

  try {
    const booking = await db.TravelerBooking.findOne({
      where: { id: bookingId, agencyId },
      include: [{ model: db.AgencyContract, as: 'contract' }],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (!booking) throw new BookingError('Rezervasyon bulunamadi.', 404);
    if (booking.status !== 'pending_provisioning') throw new BookingError('Sadece bekleyen rezervasyonlar iptal edilebilir.', 400);

    // Cancel Airalo order (non-fatal)
    if (booking.airaloRequestId) {
      try {
        await cancelOrder(booking.airaloRequestId);
      } catch (err) {
        log.warn({ err, bookingId, airaloRequestId: booking.airaloRequestId }, 'Airalo cancel failed — proceeding with local cancel');
      }
    }

    await booking.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason || null
    }, { transaction });

    // Return to pool
    await booking.contract.decrement('usedQuantity', { by: 1, transaction });
    if (booking.contract.status === 'exhausted') {
      await booking.contract.update({ status: 'active' }, { transaction });
    }

    await logAudit(ACTIONS.BOOKING_CANCEL, {
      userId: req?.session?.user?.id,
      entity: 'TravelerBooking',
      entityId: bookingId,
      details: { reason, airaloRequestId: booking.airaloRequestId },
      ipAddress: req ? getIp(req) : null
    });

    await transaction.commit();
    return { success: true };
  } catch (err) {
    await transaction.rollback();
    if (err instanceof BookingError) throw err;
    log.error({ err }, 'cancelBooking failed');
    throw new BookingError('Iptal islemi basarisiz.', 500);
  }
}

export async function changeDueDate(bookingId, newDueDate, agencyId, req) {
  const transaction = await db.sequelize.transaction();

  try {
    const booking = await db.TravelerBooking.findOne({
      where: { id: bookingId, agencyId },
      include: [
        { model: db.AgencyContract, as: 'contract', include: [{ model: db.AiraloPackage, as: 'package' }, { model: db.Agency }] }
      ],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (!booking) throw new BookingError('Rezervasyon bulunamadi.', 404);
    if (booking.status !== 'pending_provisioning') throw new BookingError('Sadece bekleyen rezervasyonlarin tarihi degistirilebilir.', 400);

    // Check 72h cutoff
    const now = new Date();
    const cutoff = new Date(booking.dueDate.getTime() - DATE_CHANGE_CUTOFF_HOURS * 60 * 60 * 1000);
    if (now > cutoff) throw new BookingError(`Tarih degisikligi icin en az ${DATE_CHANGE_CUTOFF_HOURS} saat kalmis olmalidir.`, 400);

    // Validate new date
    const newDateObj = new Date(newDueDate);
    const minDate = new Date(now.getTime() + MIN_DUE_DATE_HOURS * 60 * 60 * 1000);
    const maxDate = new Date(now);
    maxDate.setMonth(maxDate.getMonth() + MAX_DUE_DATE_MONTHS);
    if (newDateObj <= minDate) throw new BookingError(`Yeni tarih en az ${MIN_DUE_DATE_HOURS} saat sonrasi olmalidir.`, 400);
    if (newDateObj > maxDate) throw new BookingError(`Yeni tarih en fazla ${MAX_DUE_DATE_MONTHS} ay sonrasi olabilir.`, 400);

    // Cancel old, create new
    await cancelOrder(booking.airaloRequestId);
    const newRequestId = await submitFutureOrder({
      packageId: booking.contract.package.packageId,
      dueDate: newDateObj,
      agencySlug: booking.contract.Agency.slug,
      bookingId: booking.id
    });

    const oldDate = booking.dueDate;
    await booking.update({
      dueDate: newDateObj,
      airaloRequestId: newRequestId,
      changeCount: booking.changeCount + 1
    }, { transaction });

    await logAudit(ACTIONS.BOOKING_DATE_CHANGE, {
      userId: req?.session?.user?.id,
      entity: 'TravelerBooking',
      entityId: bookingId,
      details: { oldDate: oldDate.toISOString(), newDate: newDateObj.toISOString(), changeCount: booking.changeCount + 1, oldRequestId: booking.airaloRequestId, newRequestId },
      ipAddress: getIp(req)
    });

    await transaction.commit();
    return { success: true, newDueDate: newDateObj, airaloRequestId: newRequestId };
  } catch (err) {
    await transaction.rollback();
    if (err instanceof BookingError) throw err;
    log.error({ err }, 'changeDueDate failed');
    throw new BookingError('Tarih degisikligi basarisiz.', 500);
  }
}
