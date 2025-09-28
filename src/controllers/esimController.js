import { v4 as uuidv4 } from 'uuid';
import { listOffers, purchaseEsim, getPurchase, getPurchaseQrCode } from '../services/zenditClient.js';
import db from '../db/models/index.js';

// Teklifleri listele
export async function showOffers(req, res) {
  try {
    const offers = await listOffers(process.env.COUNTRY || 'TR');
    res.render('offers', { title: 'Offers', offers: offers.list });
  } catch (err) {
    console.error("❌ showOffers error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to load offers' });
  }
}

// Satın alma işlemi
export async function createPurchase(req, res) {
  try {
    const { offerId } = req.body;
    const user = await db.User.findByPk(req.session.user.id, { include: db.Esim });

    // Kullanıcının limiti dolmuş mu?
    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      return res.render('error', { message: 'eSIM limit reached' });
    }

    const transactionId = uuidv4();
    const purchase = await purchaseEsim(offerId, transactionId);

    // DB'ye kaydet
    await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: purchase.status
    });

    res.redirect(`/status/${transactionId}`);
  } catch (err) {
    console.error("❌ createPurchase error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to create purchase' });
  }
}

// Satın alma durumu
export async function showStatus(req, res) {
  try {
    const txId = req.params.txId;
    const status = await getPurchase(txId);
    res.render('status', { title: 'Purchase Status', status });
  } catch (err) {
    console.error("❌ showStatus error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to fetch status' });
  }
}

// QR kod
export async function showQrCode(req, res) {
  try {
    const txId = req.params.txId;
    const qr = await getPurchaseQrCode(txId);
    res.render('qrcode', { title: 'QR Code', qr });
  } catch (err) {
    console.error("❌ showQrCode error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to fetch QR code' });
  }
}
