import crypto from 'node:crypto';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'airalo-webhook-verifier' });
const ALGO = 'sha512';
const SIGNATURE_HEADER = 'airalo-signature';

// Mirror the airalo-sdk Signature.preparePayload behaviour: parse the body,
// re-serialise it as JSON, and escape forward slashes to match the canonical
// form Airalo signs against. Returns null for unsignable input.
function preparePayload(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'string') {
    try {
      return JSON.stringify(JSON.parse(payload)).replace(/\//g, '\\/');
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    try {
      return JSON.stringify(payload).replace(/\//g, '\\/');
    } catch {
      return null;
    }
  }
  return null;
}

function getWebhookSecret() {
  return process.env.AIRALO_WEBHOOK_SECRET || process.env.AIRALO_CLIENT_SECRET || null;
}

export function getVerifyMode() {
  const raw = (process.env.AIRALO_WEBHOOK_VERIFY || 'optional').toLowerCase();
  if (raw === 'required' || raw === 'disabled' || raw === 'optional') return raw;
  return 'optional';
}

export const AIRALO_SIGNATURE_HEADER = SIGNATURE_HEADER;

// Returns one of:
//  { ok: true, present: true }                — signature header present and verified
//  { ok: false, present: true, reason }       — header present but verification failed
//  { ok: false, present: false, reason }      — no header, no secret, malformed payload, etc.
export function verifyAiraloWebhook({ signatureHeader, payload, secret }) {
  const usedSecret = secret ?? getWebhookSecret();
  const present = Boolean(signatureHeader);

  if (!usedSecret) {
    return { ok: false, present, reason: 'no_secret_configured' };
  }
  if (!present) {
    return { ok: false, present, reason: 'no_signature_header' };
  }

  const prepared = preparePayload(payload);
  if (prepared === null) {
    return { ok: false, present, reason: 'invalid_payload' };
  }

  const expected = crypto.createHmac(ALGO, usedSecret).update(prepared).digest('hex');

  let received;
  try {
    received = Buffer.from(String(signatureHeader).trim(), 'hex');
  } catch {
    return { ok: false, present, reason: 'invalid_signature_encoding' };
  }
  const expectedBuf = Buffer.from(expected, 'hex');

  if (received.length !== expectedBuf.length) {
    return { ok: false, present, reason: 'signature_length_mismatch' };
  }

  const ok = crypto.timingSafeEqual(received, expectedBuf);
  return ok
    ? { ok: true, present }
    : { ok: false, present, reason: 'signature_mismatch' };
}

// Wrapper that pulls the signature header out of an Express req and runs the
// verification against the parsed body. Logs the outcome at warn level when
// invalid (in any mode) so operators can see signing health regardless of
// whether the verify mode is enforcing rejection.
export function verifyAiraloRequest(req) {
  const signatureHeader = req.headers?.[SIGNATURE_HEADER] || null;
  const result = verifyAiraloWebhook({
    signatureHeader,
    payload: req.body
  });

  if (!result.ok) {
    log.warn(
      {
        present: result.present,
        reason: result.reason,
        webhookType: req.body?.type || req.body?.event
      },
      'Airalo webhook signature did not verify'
    );
  }

  return result;
}
