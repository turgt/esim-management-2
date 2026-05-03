import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { cspNonce } from '../../src/middleware/cspNonce.js';

function makeRes() {
  return { locals: {} };
}

describe('cspNonce middleware', () => {
  it('sets res.locals.cspNonce to a base64 string', () => {
    const res = makeRes();
    let called = 0;
    cspNonce({}, res, () => {
      called += 1;
    });
    assert.equal(called, 1);
    assert.equal(typeof res.locals.cspNonce, 'string');
    assert.match(res.locals.cspNonce, /^[A-Za-z0-9+/]+=*$/);
  });

  it('produces 16 random bytes (base64-encoded ~22-24 chars)', () => {
    const res = makeRes();
    cspNonce({}, res, () => {});
    const decoded = Buffer.from(res.locals.cspNonce, 'base64');
    assert.equal(decoded.length, 16);
  });

  it('generates a different nonce for each request', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i += 1) {
      const res = makeRes();
      cspNonce({}, res, () => {});
      seen.add(res.locals.cspNonce);
    }
    assert.equal(seen.size, 50);
  });
});
