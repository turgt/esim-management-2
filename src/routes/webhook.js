import express from 'express';
import { Webhook } from 'svix';
import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const router = express.Router();
const log = logger.child({ module: 'webhook' });

// JSON parser that preserves raw body for signature verification
const jsonWithRawBody = express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
});

// Resend webhook - handles both outbound events and inbound emails
router.post('/resend', jsonWithRawBody, async (req, res) => {
  try {
    // Verify webhook signature (Resend uses svix)
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (webhookSecret) {
      const wh = new Webhook(webhookSecret);
      try {
        wh.verify(req.rawBody, {
          'svix-id': req.headers['svix-id'],
          'svix-timestamp': req.headers['svix-timestamp'],
          'svix-signature': req.headers['svix-signature']
        });
      } catch (verifyErr) {
        log.warn({ err: verifyErr.message }, 'Resend webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    } else {
      log.warn('RESEND_WEBHOOK_SECRET not set — webhook signature not verified');
    }

    const { type, data } = req.body;

    if (!type || !data) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    log.info({ type, emailId: data.email_id }, 'Resend webhook received');

    // === INBOUND: email.received ===
    if (type === 'email.received') {
      // Fetch full email content from Resend Received Emails API
      let emailContent = { htmlBody: null, textBody: null, attachments: [], rawDownloadUrl: null };
      try {
        const apiKey = process.env.RESEND_API_KEY;
        if (apiKey && data.email_id) {
          const axios = (await import('axios')).default;
          const resp = await axios.get(`https://api.resend.com/emails/receiving/${data.email_id}`, {
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          if (resp.data) {
            emailContent.htmlBody = resp.data.html || null;
            emailContent.textBody = resp.data.text || null;
            emailContent.attachments = resp.data.attachments || [];
            if (resp.data.raw) {
              emailContent.rawDownloadUrl = resp.data.raw.download_url || null;
              emailContent.rawExpiresAt = resp.data.raw.expires_at || null;
            }
          }
        }
      } catch (e) {
        log.warn({ err: e.message, emailId: data.email_id }, 'Could not fetch inbound email body');
      }

      await db.EmailLog.create({
        to: Array.isArray(data.to) ? data.to.join(', ') : (data.to || ''),
        subject: data.subject || '(no subject)',
        type: 'inbound',
        resendId: data.email_id,
        status: 'received',
        metadata: {
          from: data.from,
          cc: data.cc || [],
          bcc: data.bcc || [],
          messageId: data.message_id,
          ...emailContent
        }
      });

      log.info({ from: data.from, subject: data.subject }, 'Inbound email saved');
      return res.json({ received: true });
    }

    // === OUTBOUND events ===
    const emailId = data.email_id;
    if (!emailId) {
      return res.json({ received: true });
    }

    const emailLog = await db.EmailLog.findOne({ where: { resendId: emailId } });
    if (!emailLog) {
      log.warn({ emailId, type }, 'EmailLog not found for outbound event');
      return res.json({ received: true });
    }

    const updates = {};
    const now = new Date();

    switch (type) {
      case 'email.delivered':
        updates.status = 'delivered';
        updates.deliveredAt = now;
        break;
      case 'email.opened':
        updates.openedAt = emailLog.openedAt || now;
        if (emailLog.status !== 'clicked') updates.status = 'opened';
        break;
      case 'email.clicked':
        updates.clickedAt = emailLog.clickedAt || now;
        updates.status = 'clicked';
        break;
      case 'email.bounced':
        updates.status = 'bounced';
        updates.bouncedAt = now;
        updates.metadata = { ...emailLog.metadata, bounceReason: data.bounce?.message };
        break;
      case 'email.complained':
        updates.status = 'complained';
        updates.complainedAt = now;
        break;
      case 'email.delivery_delayed':
        updates.status = 'delayed';
        break;
    }

    if (Object.keys(updates).length > 0) {
      await emailLog.update(updates);
    }

    res.json({ received: true });
  } catch (err) {
    log.error({ err }, 'Webhook processing error');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
