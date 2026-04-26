#!/usr/bin/env node
/**
 * Resend webhook backfill script.
 *
 * Webhook signature verification was added on 2026-04-14 with a wrong/missing
 * RESEND_WEBHOOK_SECRET. Resend webhook calls were rejected with 401 until a
 * new webhook was created. This script recovers what was lost during that gap:
 *
 *   1. INBOUND mode  : finds inbound emails on Resend that were never saved to
 *                      EmailLog and inserts them with full content.
 *   2. OUTBOUND mode : refreshes status (delivered/opened/clicked/bounced) for
 *                      EmailLog rows still stuck on 'sent'.
 *
 * Usage (local):
 *   node scripts/backfill-resend-emails.js --mode=inbound  --since-days=12
 *   node scripts/backfill-resend-emails.js --mode=outbound --since-days=12
 *   node scripts/backfill-resend-emails.js --mode=inbound  --ids=eml_xxx,eml_yyy
 *
 * Usage on Railway:
 *   railway run --service <svc> node scripts/backfill-resend-emails.js --mode=inbound
 *   # or via SSH:
 *   railway ssh
 *   $ node scripts/backfill-resend-emails.js --mode=inbound --since-days=12
 *
 * Flags:
 *   --mode=inbound|outbound|both   (default: both)
 *   --since-days=N                 (default: 14)
 *   --ids=id1,id2,...              (manual: skip listing, process these IDs)
 *   --dry-run                      (don't write to DB, just report)
 */

import axios from 'axios';
import db from '../src/db/models/index.js';
import logger from '../src/lib/logger.js';

const log = logger.child({ module: 'resend-backfill' });

const RESEND_API = 'https://api.resend.com';
const API_KEY = process.env.RESEND_API_KEY;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const MODE = args.mode || 'both';
const SINCE_DAYS = Number(args['since-days'] || 14);
const DRY_RUN = Boolean(args['dry-run']);
const MANUAL_IDS = typeof args.ids === 'string' ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : [];

function assertApiKey() {
  if (!API_KEY) {
    log.error('RESEND_API_KEY not set in environment. Aborting.');
    process.exit(1);
  }
}

const http = axios.create({
  baseURL: RESEND_API,
  headers: { Authorization: `Bearer ${API_KEY}` },
  timeout: 20_000
});

async function fetchInboundEmail(id) {
  const resp = await http.get(`/emails/receiving/${id}`);
  return resp.data;
}

async function fetchOutboundEmail(id) {
  const resp = await http.get(`/emails/${id}`);
  return resp.data;
}

/**
 * Try to list inbound email IDs received in the last N days.
 * Resend's listing endpoint for received emails is not stably documented;
 * we try a couple of plausible paths and gracefully fall back.
 */
async function listInboundIds(sinceDays) {
  const sinceIso = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const candidatePaths = [
    `/emails/receiving?since=${encodeURIComponent(sinceIso)}&limit=100`,
    `/emails/receiving?limit=100`,
    `/emails?type=inbound&since=${encodeURIComponent(sinceIso)}&limit=100`
  ];

  for (const path of candidatePaths) {
    try {
      const resp = await http.get(path);
      const items = resp.data?.data ?? resp.data?.items ?? resp.data ?? [];
      if (Array.isArray(items) && items.length > 0) {
        log.info({ path, count: items.length }, 'Resend list endpoint returned data');
        return items
          .map((item) => item.id || item.email_id)
          .filter(Boolean);
      }
      log.warn({ path }, 'List endpoint returned no items, trying next');
    } catch (e) {
      log.warn({ path, status: e.response?.status, msg: e.message }, 'List endpoint failed, trying next');
    }
  }

  log.error('Could not list inbound emails via any known endpoint. Pass --ids=... manually from the Resend dashboard.');
  return [];
}

async function backfillInbound(ids) {
  log.info({ count: ids.length, dryRun: DRY_RUN }, 'Starting inbound backfill');
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const existing = await db.EmailLog.findOne({ where: { resendId: id } });
      if (existing) {
        skipped++;
        continue;
      }

      const email = await fetchInboundEmail(id);
      if (!email) {
        log.warn({ id }, 'Resend returned empty body');
        failed++;
        continue;
      }

      const payload = {
        to: Array.isArray(email.to) ? email.to.join(', ') : (email.to || ''),
        subject: email.subject || '(no subject)',
        type: 'inbound',
        resendId: email.id || id,
        status: 'received',
        metadata: {
          from: email.from,
          cc: email.cc || [],
          bcc: email.bcc || [],
          messageId: email.message_id,
          htmlBody: email.html || null,
          textBody: email.text || null,
          attachments: email.attachments || [],
          rawDownloadUrl: email.raw?.download_url || null,
          rawExpiresAt: email.raw?.expires_at || null,
          backfilledAt: new Date().toISOString()
        }
      };

      if (DRY_RUN) {
        log.info({ id, from: email.from, subject: email.subject }, '[dry-run] would insert');
      } else {
        await db.EmailLog.create(payload);
        log.info({ id, from: email.from, subject: email.subject }, 'inserted');
      }
      inserted++;
    } catch (e) {
      log.error({ id, status: e.response?.status, msg: e.message }, 'Failed to backfill');
      failed++;
    }
  }

  log.info({ inserted, skipped, failed }, 'Inbound backfill complete');
}

async function backfillOutbound(sinceDays) {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const stuck = await db.EmailLog.findAll({
    where: {
      type: ['sent', 'reply', 'outbound', 'transactional'].length
        ? db.Sequelize.literal(`type IN ('sent','reply','outbound','transactional','notification')`)
        : undefined,
      status: 'sent',
      createdAt: { [db.Sequelize.Op.gte]: since }
    },
    order: [['createdAt', 'ASC']],
    limit: 5000
  });

  log.info({ count: stuck.length, dryRun: DRY_RUN }, 'Starting outbound status refresh');
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of stuck) {
    if (!row.resendId) { unchanged++; continue; }
    try {
      const email = await fetchOutboundEmail(row.resendId);
      const updates = {};
      const lastEvent = email?.last_event;

      if (lastEvent === 'delivered' || email?.delivered_at) {
        updates.status = 'delivered';
        updates.deliveredAt = email.delivered_at ? new Date(email.delivered_at) : new Date();
      }
      if (email?.opened_at) {
        updates.openedAt = new Date(email.opened_at);
        if (updates.status !== 'clicked') updates.status = 'opened';
      }
      if (email?.clicked_at) {
        updates.clickedAt = new Date(email.clicked_at);
        updates.status = 'clicked';
      }
      if (email?.bounced_at || lastEvent === 'bounced') {
        updates.status = 'bounced';
        updates.bouncedAt = email.bounced_at ? new Date(email.bounced_at) : new Date();
      }
      if (email?.complained_at || lastEvent === 'complained') {
        updates.status = 'complained';
        updates.complainedAt = email.complained_at ? new Date(email.complained_at) : new Date();
      }

      if (Object.keys(updates).length === 0) {
        unchanged++;
        continue;
      }

      if (DRY_RUN) {
        log.info({ id: row.resendId, updates }, '[dry-run] would update');
      } else {
        await row.update(updates);
      }
      updated++;
    } catch (e) {
      log.warn({ id: row.resendId, status: e.response?.status, msg: e.message }, 'Could not refresh');
      failed++;
    }
  }

  log.info({ updated, unchanged, failed }, 'Outbound refresh complete');
}

async function main() {
  assertApiKey();

  if (MODE === 'inbound' || MODE === 'both') {
    const ids = MANUAL_IDS.length ? MANUAL_IDS : await listInboundIds(SINCE_DAYS);
    if (ids.length > 0) {
      await backfillInbound(ids);
    } else {
      log.warn('No inbound IDs to process.');
    }
  }

  if (MODE === 'outbound' || MODE === 'both') {
    await backfillOutbound(SINCE_DAYS);
  }

  await db.sequelize.close();
  log.info('Done.');
}

main().catch((err) => {
  log.error({ err }, 'Fatal error');
  process.exit(1);
});
