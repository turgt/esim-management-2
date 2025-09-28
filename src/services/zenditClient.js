import axios from 'axios';

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

// eSIM satın al
export async function purchaseEsim(offerId, transactionId) {
  const body = { offerId, transactionId };
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
