const axios = require('axios');

const api = axios.create({
  baseURL: process.env.ZENDIT_API_BASE,
  headers: {
    'Authorization': `Bearer ${process.env.ZENDIT_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

module.exports = {
  listOffers: () => api.get('/esim/offers'),
  getOffer: (offerId) => api.get(`/esim/offers/${offerId}`),
  purchaseEsim: (data) => api.post('/esim/purchases', data),
  getTransaction: (id) => api.get(`/esim/transactions/${id}`),
  getTransactionQRCode: (id) => api.get(`/esim/transactions/${id}/qrcode`),
  getUsage: (id) => api.get(`/esim/${id}/usage`)
};
