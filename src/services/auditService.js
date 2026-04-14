import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'audit' });

// Action types
export const ACTIONS = {
  LOGIN: 'user.login',
  LOGOUT: 'user.logout',
  REGISTER: 'user.register',
  PASSWORD_CHANGE: 'user.password_change',
  PASSWORD_RESET: 'user.password_reset',
  PROFILE_UPDATE: 'user.profile_update',
  USER_CREATE: 'admin.user_create',
  USER_EDIT: 'admin.user_edit',
  ESIM_PURCHASE: 'esim.purchase',
  ESIM_ASSIGN: 'admin.esim_assign',
  ESIM_TOPUP: 'admin.esim_topup',
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_SUCCESS: 'payment.success',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_RETRY: 'admin.payment_retry',
  PAYMENT_RESOLVED: 'admin.payment_resolved',
  VENDOR_CREATE: 'admin.vendor_create',
  VENDOR_EDIT: 'admin.vendor_edit',
  VENDOR_DELETE: 'admin.vendor_delete',
  AGENCY_CREATE: 'admin.agency_create',
  AGENCY_EDIT: 'admin.agency_edit',
  CONTRACT_CREATE: 'admin.contract_create',
  CONTRACT_EDIT: 'admin.contract_edit',
  BOOKING_CREATE: 'agency.booking_create',
  BOOKING_CANCEL: 'agency.booking_cancel',
  BOOKING_DATE_CHANGE: 'agency.booking_date_change',
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSED: 'webhook.processed',
  WEBHOOK_FAILED: 'webhook.failed',
  WEBHOOK_RETRIED: 'admin.webhook_retry',
};

export async function logAudit(action, { userId = null, entity = null, entityId = null, details = null, ipAddress = null } = {}) {
  try {
    await db.AuditLog.create({
      userId,
      action,
      entity,
      entityId,
      details,
      ipAddress
    });
  } catch (err) {
    log.error({ err, action, userId }, 'Audit log error');
  }
}

// Helper to extract IP from request
export function getIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}
