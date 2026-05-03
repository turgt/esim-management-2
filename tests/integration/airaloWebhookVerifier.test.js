import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';

import {
  verifyAiraloWebhook,
  verifyAiraloRequest,
  getVerifyMode,
  AIRALO_SIGNATURE_HEADER
} from '../../src/services/airaloWebhookVerifier.js';

const SECRET = 'test-secret-abc123';

// Mirror the airalo-sdk Signature.signData + preparePayload pipeline so the
// fixture below produces the same bytes Airalo would.
function signLikeAiralo(secret, body) {
  const prepared = JSON.stringify(body).replace(/\//g, '\\/');
  return crypto.createHmac('sha512', secret).update(prepared).digest('hex');
}

describe('verifyAiraloWebhook', () => {
  it('returns ok=true for a correctly signed body', () => {
    const body = { type: 'order.completed', data: { request_id: 'r1' } };
    const sig = signLikeAiralo(SECRET, body);

    const result = verifyAiraloWebhook({
      signatureHeader: sig,
      payload: body,
      secret: SECRET
    });

    assert.equal(result.ok, true);
    assert.equal(result.present, true);
  });

  it('handles forward-slash escaping in payloads with URLs', () => {
    const body = { url: 'https://example.com/path/to/resource' };
    const sig = signLikeAiralo(SECRET, body);

    const result = verifyAiraloWebhook({
      signatureHeader: sig,
      payload: body,
      secret: SECRET
    });

    assert.equal(result.ok, true);
  });

  it('returns ok=false with reason=signature_mismatch on a tampered body', () => {
    const body = { type: 'order.completed', data: { request_id: 'r1' } };
    const sig = signLikeAiralo(SECRET, body);
    const tampered = { ...body, data: { request_id: 'r2-attacker' } };

    const result = verifyAiraloWebhook({
      signatureHeader: sig,
      payload: tampered,
      secret: SECRET
    });

    assert.equal(result.ok, false);
    assert.equal(result.present, true);
    assert.equal(result.reason, 'signature_mismatch');
  });

  it('returns ok=false with reason=signature_length_mismatch on a wrong-length signature', () => {
    const body = { type: 'order.completed' };
    const result = verifyAiraloWebhook({
      signatureHeader: 'deadbeef',
      payload: body,
      secret: SECRET
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'signature_length_mismatch');
  });

  it('returns ok=false with reason=no_signature_header when missing', () => {
    const body = { type: 'order.completed' };
    const result = verifyAiraloWebhook({
      signatureHeader: null,
      payload: body,
      secret: SECRET
    });
    assert.equal(result.ok, false);
    assert.equal(result.present, false);
    assert.equal(result.reason, 'no_signature_header');
  });

  it('returns ok=false with reason=no_secret_configured when no secret', () => {
    const body = { type: 'order.completed' };
    const result = verifyAiraloWebhook({
      signatureHeader: 'a'.repeat(128),
      payload: body,
      secret: null
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_secret_configured');
  });

  it('returns ok=false with reason=invalid_payload on an unsignable payload', () => {
    const result = verifyAiraloWebhook({
      signatureHeader: 'a'.repeat(128),
      payload: undefined,
      secret: SECRET
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_payload');
  });
});

describe('verifyAiraloRequest', () => {
  it('reads the airalo-signature header from req.headers', () => {
    const body = { type: 'order.completed', data: { request_id: 'r1' } };
    const sig = signLikeAiralo(SECRET, body);

    process.env.AIRALO_WEBHOOK_SECRET = SECRET;
    try {
      const req = {
        headers: { [AIRALO_SIGNATURE_HEADER]: sig },
        body
      };
      const result = verifyAiraloRequest(req);
      assert.equal(result.ok, true);
      assert.equal(result.present, true);
    } finally {
      delete process.env.AIRALO_WEBHOOK_SECRET;
    }
  });

  it('falls back to AIRALO_CLIENT_SECRET when AIRALO_WEBHOOK_SECRET is unset', () => {
    const body = { type: 'order.completed' };
    const sig = signLikeAiralo(SECRET, body);

    process.env.AIRALO_CLIENT_SECRET = SECRET;
    delete process.env.AIRALO_WEBHOOK_SECRET;
    try {
      const req = { headers: { [AIRALO_SIGNATURE_HEADER]: sig }, body };
      const result = verifyAiraloRequest(req);
      assert.equal(result.ok, true);
    } finally {
      delete process.env.AIRALO_CLIENT_SECRET;
    }
  });
});

describe('getVerifyMode', () => {
  it('defaults to "optional" when unset', () => {
    delete process.env.AIRALO_WEBHOOK_VERIFY;
    assert.equal(getVerifyMode(), 'optional');
  });

  it('accepts "required", "disabled", "optional" case-insensitively', () => {
    process.env.AIRALO_WEBHOOK_VERIFY = 'REQUIRED';
    assert.equal(getVerifyMode(), 'required');
    process.env.AIRALO_WEBHOOK_VERIFY = 'Disabled';
    assert.equal(getVerifyMode(), 'disabled');
    process.env.AIRALO_WEBHOOK_VERIFY = 'optional';
    assert.equal(getVerifyMode(), 'optional');
    delete process.env.AIRALO_WEBHOOK_VERIFY;
  });

  it('falls back to "optional" on unrecognised values', () => {
    process.env.AIRALO_WEBHOOK_VERIFY = 'enforce';
    assert.equal(getVerifyMode(), 'optional');
    delete process.env.AIRALO_WEBHOOK_VERIFY;
  });
});
