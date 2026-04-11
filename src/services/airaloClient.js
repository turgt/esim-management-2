import { Airalo } from 'airalo-sdk';
import axios from 'axios';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'airalo' });

const API_BASE = 'https://partners-api.airalo.com/v2';

let airalo = null;
let accessToken = null;

// Initialize the Airalo SDK instance
export async function initialize() {
  const clientId = process.env.AIRALO_CLIENT_ID;
  const clientSecret = process.env.AIRALO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    log.warn('Airalo credentials not configured, skipping initialization');
    return;
  }

  try {
    airalo = new Airalo({
      client_id: clientId,
      client_secret: clientSecret,
    });
    await airalo.initialize();
    log.info('Airalo SDK initialized');

    // Get access token for REST calls not covered by SDK
    await refreshToken();

    // Refresh token every 23 hours (tokens typically expire in 24h)
    setInterval(refreshToken, 23 * 60 * 60 * 1000);
  } catch (err) {
    log.error({ err }, 'Failed to initialize Airalo SDK');
  }
}

// Refresh OAuth token for direct REST calls
async function refreshToken() {
  try {
    const res = await axios.post(`${API_BASE}/token`, new URLSearchParams({
      client_id: process.env.AIRALO_CLIENT_ID,
      client_secret: process.env.AIRALO_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }), {
      headers: { Accept: 'application/json' }
    });
    accessToken = res.data.data.access_token;
    log.info('Airalo access token refreshed');
  } catch (err) {
    log.error({ err }, 'Failed to refresh Airalo token');
  }
}

// Helper for authenticated REST calls
function restApi() {
  return axios.create({
    baseURL: API_BASE,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });
}

// Get all packages (flat format for sync)
export async function getAllPackages() {
  if (!airalo) throw new Error('Airalo not initialized');
  return airalo.getAllPackages(true);
}

// Get packages by country (non-flat to retain full operator data including networks)
export async function getCountryPackages(countryCode) {
  if (!airalo) throw new Error('Airalo not initialized');
  return airalo.getCountryPackages(countryCode, false);
}

// Place an order (returns order with sims array containing iccid, qrcode_url, lpa, etc.)
export async function createOrder(packageId, quantity = 1, description = '') {
  if (!airalo) throw new Error('Airalo not initialized');
  const result = await airalo.order(packageId, quantity, description || `DataPatch order ${Date.now()}`);
  log.info({ packageId, quantity, orderId: result?.data?.id }, 'Airalo order placed');
  return result;
}

// Get eSIM details by ICCID (REST — not in SDK)
export async function getEsim(iccid) {
  const res = await restApi().get(`/sims/${iccid}`);
  return res.data;
}

// Get eSIM usage (REST — not in SDK)
export async function getUsage(iccid) {
  const res = await restApi().get(`/sims/${iccid}/usage`);
  return res.data;
}

// Get available top-up packages for an eSIM (REST)
export async function getTopupPackages(iccid) {
  const res = await restApi().get(`/sims/${iccid}/topups`);
  return res.data;
}

// Submit a top-up order (REST)
export async function createTopup(packageId, iccid, description = '') {
  const formData = new URLSearchParams();
  formData.append('package_id', packageId);
  formData.append('iccid', iccid);
  if (description) formData.append('description', description);

  const res = await restApi().post('/orders/topups', formData);
  log.info({ packageId, iccid, orderId: res.data?.data?.id }, 'Airalo top-up order placed');
  return res.data;
}

// Get account balance (REST)
export async function getBalance() {
  const res = await restApi().get('/balance');
  const balanceData = res.data?.data?.balances?.availableBalance;
  return {
    amount: balanceData?.amount || 0,
    currency: balanceData?.currency || 'USD',
  };
}

// Check if Airalo balance is sufficient
export async function checkBalance(amount) {
  try {
    const balance = await getBalance();
    log.info({ available: balance.amount, required: amount }, 'Airalo balance check');
    return {
      sufficient: balance.amount >= amount,
      available: balance.amount,
      required: amount,
    };
  } catch (err) {
    log.error({ err }, 'Failed to check Airalo balance');
    return { sufficient: false, available: 0, required: amount, error: err.message };
  }
}

export function isInitialized() {
  return airalo !== null;
}
