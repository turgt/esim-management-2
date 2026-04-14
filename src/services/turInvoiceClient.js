import axios from 'axios';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'turInvoice' });

let sessionCookie = null;
let apiBase = null;

export async function initialize() {
  apiBase = process.env.TURINVOICE_HOST;
  const login = process.env.TURINVOICE_LOGIN;
  const password = process.env.TURINVOICE_PASSWORD;

  if (!apiBase || !login || !password) {
    log.warn('TurInvoice credentials not configured, skipping initialization');
    return false;
  }

  try {
    await doLogin(login, password);
    log.info('TurInvoice client initialized');
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to initialize TurInvoice client');
    return false;
  }
}

async function doLogin(login, password) {
  const res = await axios.post(`${apiBase}/api/v1/auth/login`, {
    login: login || process.env.TURINVOICE_LOGIN,
    password: password || process.env.TURINVOICE_PASSWORD
  }, {
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true
  });

  const cookies = res.headers['set-cookie'];
  if (cookies) {
    const sessionMatch = cookies.join(';').match(/sessionid=([^;]+)/);
    if (sessionMatch) {
      sessionCookie = sessionMatch[1];
    }
  }

  if (res.data?.code !== 'OK') {
    throw new Error(`TurInvoice login failed: ${JSON.stringify(res.data)}`);
  }

  log.info('TurInvoice login successful');
}

function api() {
  return axios.create({
    baseURL: apiBase,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: `sessionid=${sessionCookie}` } : {})
    },
    timeout: 15000
  });
}

async function withAutoRelogin(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.response?.status === 401) {
      log.info('TurInvoice session expired, re-logging in');
      await doLogin();
      return await fn();
    }
    throw err;
  }
}

export async function createOrder({ amount, currency, name, callbackUrl, redirectUrl }) {
  const idTSP = Number(process.env.TURINVOICE_IDTSP);
  return withAutoRelogin(async () => {
    const res = await api().put('/api/v1/tsp/order', {
      idTSP,
      amount,
      currency: currency || 'USD',
      name: name || 'eSIM purchase',
      quantity: 1,
      ...(callbackUrl ? { callbackUrl } : {}),
      ...(redirectUrl ? { redirectUrl } : {})
    });
    log.info({ idOrder: res.data?.idOrder, amount, currency }, 'TurInvoice order created');
    return res.data;
  });
}

export async function getOrder(idOrder) {
  return withAutoRelogin(async () => {
    const res = await api().get('/api/v1/tsp/order', { params: { idOrder } });
    return res.data;
  });
}

export async function getQrCode(idOrder) {
  return withAutoRelogin(async () => {
    const res = await api().get('/api/v1/tsp/order/payment/qr', {
      params: { idOrder },
      responseType: 'arraybuffer'
    });
    return {
      data: res.data,
      contentType: res.headers['content-type'] || 'image/png'
    };
  });
}

export async function refund({ idOrder, amount, description }) {
  return withAutoRelogin(async () => {
    const res = await api().put('/api/v1/tsp/refund', {
      idOrder,
      ...(amount != null ? { amount } : {}),
      ...(description ? { description } : {})
    });
    log.info({ idOrder, amount }, 'TurInvoice refund requested');
    return res.data;
  });
}

export function isInitialized() {
  return sessionCookie !== null;
}

export function isEnabled() {
  return process.env.TURINVOICE_ENABLED === 'true';
}
