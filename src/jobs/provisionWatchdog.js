import db from '../db/models/index.js';
import { pollOrderStatus } from '../services/futureOrderService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:provision-watchdog' });

export async function run() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const stuckBookings = await db.TravelerBooking.findAll({
    where: { status: 'pending_provisioning', dueDate: { [db.Sequelize.Op.lt]: twoHoursAgo } },
    limit: 20
  });
  if (stuckBookings.length === 0) return;
  log.info({ count: stuckBookings.length }, 'Checking stuck provisioning bookings');
  for (const booking of stuckBookings) {
    if (!booking.airaloRequestId) continue;
    try {
      const status = await pollOrderStatus(booking.airaloRequestId);
      log.info({ bookingId: booking.id, airaloStatus: status?.status }, 'Polled Airalo order status');
    } catch (err) {
      log.error({ err, bookingId: booking.id }, 'Watchdog poll failed');
    }
  }
}
