import axios from 'axios';

const api = axios.create({
  baseURL: process.env.ZENDIT_API_BASE || 'https://api.zendit.io/v1',
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${process.env.ZENDIT_API_KEY || ''}`,
  },
  timeout: 15000,
});

export async function listOffers({ country, limit = 100, offset = 1, brand = '', subType = '' }) {
  const params = { _limit: limit, _offset: offset, brand, country, subType };
  const { data } = await api.get('/esim/offers', { params });
  return data;
}

export async function purchaseEsim({ offerId, transactionId }) {
  const body = { offerId, transactionId };
  const { data } = await api.post('/esim/purchases', body, { headers: { 'Content-Type': 'application/json' } });
  return data;
}

export async function getPurchase(transactionId) {
  const { data } = await api.get(`/esim/purchases/${encodeURIComponent(transactionId)}`);
  return data;
}

export async function getPurchaseQrCode(transactionId) {
  const { data } = await api.get(`/esim/purchases/${encodeURIComponent(transactionId)}/qrcode`);
  return data;
}
