import axios from 'axios';

const api=axios.create({
  baseURL:process.env.ZENDIT_API_BASE,
  headers:{Accept:'application/json',Authorization:`Bearer ${process.env.ZENDIT_API_KEY}`}
});

export async function listOffers(params){
  return (await api.get('/esim/offers',{params})).data;
}

export async function purchaseEsim(body){
  return (await api.post('/esim/purchases',body)).data;
}

export async function getPurchase(txId){
  return (await api.get(`/esim/purchases/${txId}`)).data;
}

export async function getPurchaseQrCode(txId){
  return (await api.get(`/esim/purchases/${txId}/qrcode`)).data;
}
