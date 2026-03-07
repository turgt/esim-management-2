import logger from './logger.js';

const REQUIRED_VARS = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'ZENDIT_API_KEY'
];

const OPTIONAL_DEFAULTS = {
  PORT: '3000',
  COUNTRY: 'TR',
  OFFERS_LIMIT: '100',
  ZENDIT_API_BASE: 'https://api.zendit.io/v1'
};

export function validateEnv() {
  const log = logger.child({ module: 'startup' });
  const missing = [];

  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (process.env.SESSION_SECRET === 'supersecret' ||
      process.env.SESSION_SECRET === 'development-secret-change-in-production') {
    log.warn('SESSION_SECRET is using an insecure default value');
  }

  for (const [varName, defaultValue] of Object.entries(OPTIONAL_DEFAULTS)) {
    if (!process.env[varName]) {
      process.env[varName] = defaultValue;
      log.info({ variable: varName, default: defaultValue }, 'Using default value for env var');
    }
  }

  // Warn about partial SMTP config
  const smtpVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const configuredSmtp = smtpVars.filter(v => process.env[v]);
  if (configuredSmtp.length > 0 && configuredSmtp.length < smtpVars.length) {
    const missingSmtp = smtpVars.filter(v => !process.env[v]);
    log.warn({ configured: configuredSmtp, missing: missingSmtp }, 'Partial SMTP configuration');
  }

  if (missing.length > 0) {
    log.fatal({ missing }, 'Required environment variables are not set');
    process.exit(1);
  }

  log.info('Environment validation passed');
}
