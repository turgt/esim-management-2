import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

let transportConfig = {};
if (!isProduction) {
  try {
    await import('pino-pretty');
    transportConfig = {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname'
        }
      }
    };
  } catch {
    // pino-pretty not available (production build), use default JSON output
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

  ...transportConfig,

  base: {
    service: 'esim-hub',
    env: process.env.NODE_ENV || 'development'
  },

  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'passwordHash', 'token'],
    censor: '[REDACTED]'
  },

  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res
  }
});

export default logger;
