import axios from 'axios';

// Zendit API status → internal status mapping
const STATUS_MAP = {
  'DONE': 'completed',
  'ACCEPTED': 'completed',
  'AUTHORIZED': 'processing',
  'IN_PROGRESS': 'processing',
  'PENDING': 'pending',
  'FAILED': 'failed',
  'CANCELLED': 'failed',
  'REJECTED': 'failed',
  'ERROR': 'failed'
};

// Normalize Zendit status to internal status
export function normalizeStatus(zenditStatus) {
  if (!zenditStatus) return 'pending';
  const upper = zenditStatus.toUpperCase();
  return STATUS_MAP[upper] || zenditStatus.toLowerCase();
}

// Check if a status means the eSIM is ready/active
export function isCompletedStatus(status) {
  if (!status) return false;
  const normalized = normalizeStatus(status);
  return normalized === 'completed';
}

const api = axios.create({
  baseURL: process.env.ZENDIT_API_BASE || 'https://api.zendit.io/v1',
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${process.env.ZENDIT_API_KEY}`
  },
  timeout: 10000
});

// Teklifleri listele
export async function listOffers(country = process.env.COUNTRY || 'TR') {
  const params = {
    _limit: process.env.OFFERS_LIMIT || 1024,
    _offset: 1,
    brand: '',
    country,
    subType: ''
  };
  const res = await api.get('/esim/offers', { params });
  return res.data;
}

// Tekil teklif detayı
export async function getOffer(offerId) {
  const res = await api.get(`/esim/offers/${offerId}`);
  return res.data;
}

// eSIM satın al (iccid verilirse top-up yapar)
export async function purchaseEsim(offerId, transactionId, iccid = null) {
  const body = { offerId, transactionId };
  if (iccid) {
    body.iccid = iccid;
  }
  const res = await api.post('/esim/purchases', body, {
    headers: { 'Content-Type': 'application/json' }
  });
  return res.data;
}

// Satın alma durumu
export async function getPurchase(txId) {
  const res = await api.get(`/esim/purchases/${txId}`);
  return res.data;
}

// QR kodu al
export async function getPurchaseQrCode(txId) {
  const res = await api.get(`/esim/purchases/${txId}/qrcode`);
  return res.data;
}

// Kullanım bilgisi al
export async function getUsage(txId) {
  const res = await api.get(`/esim/purchases/${txId}/usage`);
  return res.data;
}

// ICCID'ye atanmış planları getir
export async function getEsimPlans(iccid) {
  const res = await api.get(`/esim/${iccid}/plans`);
  return res.data;
}

// Bakiye kontrolü
export async function getBalance() {
  const res = await api.get('/balance');
  return res.data;
}
