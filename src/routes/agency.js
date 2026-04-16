import express from 'express';
import { ensureAgency } from '../middleware/agency.js';
import {
  showDashboard,
  listBookings,
  showNewBookingForm,
  handleCreateBooking,
  showBookingDetail,
  handleCancelBooking,
  handleChangeDueDate,
  listContracts
} from '../controllers/agencyController.js';

const router = express.Router();

router.use(ensureAgency);

router.get('/', showDashboard);
router.get('/dashboard', showDashboard);
router.get('/bookings', listBookings);
router.get('/bookings/new', showNewBookingForm);
router.post('/bookings', handleCreateBooking);
router.get('/bookings/:id', showBookingDetail);
router.post('/bookings/:id/cancel', handleCancelBooking);
router.post('/bookings/:id/change-date', handleChangeDueDate);
router.get('/contracts', listContracts);

export default router;
