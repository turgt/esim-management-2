import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';

// Force in-memory fallback for these tests (no Redis configured)
delete process.env.REDIS_URL;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/esim_test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.ZENDIT_API_KEY = process.env.ZENDIT_API_KEY || 'test_key';

let smartRateLimit;
let endpointRateLimit;

before(async () => {
  const mod = await import('../../src/middleware/performance.js');
  smartRateLimit = mod.smartRateLimit;
  endpointRateLimit = mod.endpointRateLimit;
});

function makeReq({ ip = '1.2.3.4', user = null } = {}) {
  return {
    ip,
    connection: { remoteAddress: ip },
    session: user ? { user } : null
  };
}

function makeRes() {
  const headers = {};
  const result = {
    statusCode: 200,
    renderedView: null,
    renderedLocals: null,
    headers
  };
  const res = {};
  res.status = (code) => {
    result.statusCode = code;
    return res;
  };
  res.render = (view, locals) => {
    result.renderedView = view;
    result.renderedLocals = locals;
  };
  res.setHeader = (k, v) => {
    headers[k] = v;
  };
  res.headersSent = false;
  res._result = result;
  return res;
}

async function run(middleware, opts = {}) {
  const req = makeReq(opts);
  const res = makeRes();
  let nextCalls = 0;
  await middleware(req, res, () => {
    nextCalls += 1;
  });
  return { res, nextCalls };
}

describe('rate limiting middleware (in-memory fallback)', () => {
  describe('endpointRateLimit', () => {
    it('allows up to maxRequests then blocks with 429', async () => {
      const limiter = endpointRateLimit(60_000, 3, 'test-block-after-limit');

      for (let i = 0; i < 3; i += 1) {
        const r = await run(limiter, { ip: '10.0.0.1' });
        assert.equal(r.nextCalls, 1);
        assert.equal(r.res._result.statusCode, 200);
      }

      const blocked = await run(limiter, { ip: '10.0.0.1' });
      assert.equal(blocked.nextCalls, 0);
      assert.equal(blocked.res._result.statusCode, 429);
      assert.equal(blocked.res._result.renderedView, 'error');
      assert.ok(blocked.res._result.headers['Retry-After'] !== undefined);
    });

    it('isolates counters by IP', async () => {
      const limiter = endpointRateLimit(60_000, 2, 'test-ip-isolation');
      await run(limiter, { ip: '10.0.0.2' });
      await run(limiter, { ip: '10.0.0.2' });
      const blocked = await run(limiter, { ip: '10.0.0.2' });
      assert.equal(blocked.res._result.statusCode, 429);

      const other = await run(limiter, { ip: '10.0.0.3' });
      assert.equal(other.res._result.statusCode, 200);
      assert.equal(other.nextCalls, 1);
    });

    it('isolates counters between named instances on the same IP', async () => {
      const a = endpointRateLimit(60_000, 1, 'test-iso-a');
      const b = endpointRateLimit(60_000, 1, 'test-iso-b');

      await run(a, { ip: '10.0.0.4' });
      const aBlocked = await run(a, { ip: '10.0.0.4' });
      assert.equal(aBlocked.res._result.statusCode, 429);

      const bAllowed = await run(b, { ip: '10.0.0.4' });
      assert.equal(bAllowed.res._result.statusCode, 200);
    });
  });

  describe('smartRateLimit role-based multipliers', () => {
    it('anonymous request gets the base limit', async () => {
      const limiter = smartRateLimit(60_000, 2, 'test-role-anon');
      await run(limiter, { ip: '10.0.1.1' });
      await run(limiter, { ip: '10.0.1.1' });
      const blocked = await run(limiter, { ip: '10.0.1.1' });
      assert.equal(blocked.res._result.statusCode, 429);
    });

    it('authenticated user gets 2x the base limit', async () => {
      const limiter = smartRateLimit(60_000, 2, 'test-role-authed');
      const user = { id: 1, isAdmin: false };

      for (let i = 0; i < 4; i += 1) {
        const r = await run(limiter, { ip: '10.0.1.2', user });
        assert.equal(r.res._result.statusCode, 200);
      }
      const blocked = await run(limiter, { ip: '10.0.1.2', user });
      assert.equal(blocked.res._result.statusCode, 429);
    });

    it('admin user gets 5x the base limit', async () => {
      const limiter = smartRateLimit(60_000, 2, 'test-role-admin');
      const user = { id: 99, isAdmin: true };

      for (let i = 0; i < 10; i += 1) {
        const r = await run(limiter, { ip: '10.0.1.3', user });
        assert.equal(r.res._result.statusCode, 200);
      }
      const blocked = await run(limiter, { ip: '10.0.1.3', user });
      assert.equal(blocked.res._result.statusCode, 429);
    });

    it('sets X-RateLimit-* headers on success', async () => {
      const limiter = smartRateLimit(60_000, 5, 'test-headers');
      const { res } = await run(limiter, { ip: '10.0.1.4' });
      assert.equal(res._result.headers['X-RateLimit-Limit'], 5);
      assert.equal(typeof res._result.headers['X-RateLimit-Remaining'], 'number');
      assert.ok(res._result.headers['X-RateLimit-Reset'] > 0);
    });

    it('roles use independent buckets on the same IP', async () => {
      const limiter = smartRateLimit(60_000, 1, 'test-role-buckets');
      const ip = '10.0.1.5';

      const anon = await run(limiter, { ip });
      assert.equal(anon.res._result.statusCode, 200);
      const anonBlocked = await run(limiter, { ip });
      assert.equal(anonBlocked.res._result.statusCode, 429);

      // Same IP but logged in — fresh authed bucket (2x limit, fresh counter)
      const user = { id: 5, isAdmin: false };
      const authed = await run(limiter, { ip, user });
      assert.equal(authed.res._result.statusCode, 200);
      const authedSecond = await run(limiter, { ip, user });
      assert.equal(authedSecond.res._result.statusCode, 200);
    });
  });
});
