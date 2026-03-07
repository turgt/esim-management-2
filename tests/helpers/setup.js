import { jest } from '@jest/globals';

// Mock environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/esim_test';
process.env.SESSION_SECRET = 'test-secret';
process.env.ZENDIT_API_KEY = 'test_key';
process.env.ZENDIT_API_BASE = 'https://api.zendit.io/v1';
process.env.COUNTRY = 'TR';
process.env.APP_URL = 'http://localhost:3000';

// Helper to create a test user
export function createTestUser(overrides = {}) {
  return {
    username: 'testuser',
    email: 'test@example.com',
    password: 'TestPass123',
    displayName: 'Test User',
    ...overrides
  };
}

// Helper to create admin user
export function createAdminUser(overrides = {}) {
  return {
    username: 'admin',
    email: 'admin@example.com',
    password: 'AdminPass123',
    isAdmin: true,
    ...overrides
  };
}

// Mock session middleware
export function mockSession(userData = null) {
  return (req, res, next) => {
    req.session = {
      user: userData,
      destroy: (cb) => cb && cb(),
      save: (cb) => cb && cb()
    };
    next();
  };
}

export default { createTestUser, createAdminUser, mockSession };
