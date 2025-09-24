import { v4 as uuidv4 } from 'uuid';
import { listOffers, purchaseEsim, getPurchase, getPurchaseQrCode } from '../services/zenditClient.js';

const COUNTRY = process.env.COUNTRY || 'TR';
const OFFERS_LIMIT = parseInt(process.env.OFFERS_LIMIT || '100', 10);

export async function getOffers(req, res, next) {
  try {
    const offers = await listOffers({ country: COUNTRY, limit: OFFERS_LIMIT, offset: 1 });
    res.render('offers', { title: 'eSIM Offers', offers, country: COUNTRY });
  } catch (err) {
    next(err);
  }
}

export async function createPurchase(req, res, next) {
  try {
    const { offerId } = req.body;
    if (!offerId) throw new Error('offerId is required');
    const transactionId = uuidv4();
    const result = await purchaseEsim({ offerId, transactionId });
    res.redirect(`/purchases/${transactionId}?accepted=${encodeURIComponent(result?.status || '')}`);
  } catch (err) {
    next(err);
  }
}

export async function getPurchaseStatus(req, res, next) {
  try {
    const { txId } = req.params;
    const purchase = await getPurchase(txId);
    res.render('status', { title: 'Purchase Status', purchase, txId });
  } catch (err) {
    next(err);
  }
}

export async function getPurchaseQr(req, res, next) {
  try {
    const { txId } = req.params;
    const qr = await getPurchaseQrCode(txId);
    const imgSrc = `data:image/png;base64,${qr.imageBase64}`;
    res.render('qrcode', { title: 'eSIM QR Code', txId, imgSrc });
  } catch (err) {
    next(err);
  }
}
