import pinoHttp from 'pino-http';
import logger from './logger.js';
import { randomUUID } from 'crypto';

const httpLogger = pinoHttp({
  logger,

  genReqId: (req) => req.headers['x-request-id'] || randomUUID(),

  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.statusCode >= 300) return 'silent';
    return 'info';
  },

  autoLogging: {
    ignore: (req) => {
      const ignorePaths = ['/health', '/healthz', '/sw.js', '/favicon.ico', '/robots.txt'];
      return ignorePaths.some(p => req.url.startsWith(p)) || req.url.match(/^\/public\//);
    }
  },

  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },

  customProps: (req) => ({
    user: req.session?.user?.username || 'anonymous',
    userId: req.session?.user?.id || null
  })
});

export default httpLogger;
