import { v4 as uuidv4 } from 'uuid';
import { listOffers, purchaseEsim, getPurchase, getPurchaseQrCode } from '../services/zenditClient.js';
import db from '../db/models/index.js';

// Teklifleri listele
export async function showOffers(req, res) {
  try {
    const offers = await listOffers(process.env.COUNTRY || 'TR');
    const activeOffers = offers.list.filter(o => o.enabled);
    res.render('offers', { title: 'Offers', offers: activeOffers });
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
    console.log(`🛒 Creating purchase - User: ${user.username}, Offer: ${offerId}, TX: ${transactionId}`);
    
    const purchase = await purchaseEsim(offerId, transactionId);
    console.log(`✅ Purchase created with status: ${purchase.status}`);

    // DB'ye kaydet
    await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: purchase.status || 'pending'
    });

    res.redirect(`/status/${transactionId}`);
  } catch (err) {
    console.error("❌ createPurchase error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to create purchase' });
  }
}

// Satın alma durumu - VERİTABANI GÜNCELLEMESİ İLE
export async function showStatus(req, res) {
  try {
    const txId = req.params.txId;
    console.log(`🔍 Checking status for transaction: ${txId}`);
    
    // 1. API'den güncel durumu al
    const apiStatus = await getPurchase(txId);
    console.log(`📡 API Status: ${apiStatus.status}`);
    
    // 2. Veritabanındaki kaydı bul
    const esimRecord = await db.Esim.findOne({ 
      where: { transactionId: txId },
      include: [{
        model: db.User,
        attributes: ['id', 'username']
      }]
    });
    
    if (!esimRecord) {
      return res.render('error', { message: 'eSIM record not found' });
    }
    
    // 3. Eğer status değişmişse veritabanını güncelle
    if (esimRecord.status !== apiStatus.status) {
      console.log(`🔄 Updating status: ${esimRecord.status} → ${apiStatus.status}`);
      
      await esimRecord.update({
        status: apiStatus.status
      });
      
      console.log(`✅ Status updated in database`);
    }
    
    // 4. QR Code butonunun görünüp görünmeyeceğini belirle
    const isQrReady = ['completed', 'success', 'active', 'ready'].includes(
      apiStatus.status.toLowerCase()
    );
    
    res.render('status', { 
      title: 'Purchase Status', 
      status: apiStatus,
      isQrReady: isQrReady,
      dbStatus: esimRecord.status // Debug için
    });
  } catch (err) {
    console.error("❌ showStatus error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to fetch status' });
  }
}

// QR kod
export async function showQrCode(req, res) {
  try {
    const txId = req.params.txId;
    console.log(`📱 Fetching QR code for transaction: ${txId}`);
    
    // İlk olarak status'u kontrol et
    const status = await getPurchase(txId);
    
    if (!['completed', 'success', 'active', 'ready'].includes(status.status.toLowerCase())) {
      return res.render('error', { 
        message: `QR code not ready yet. Current status: ${status.status}` 
      });
    }
    
    const qr = await getPurchaseQrCode(txId);
    res.render('qrcode', { title: 'QR Code', qr });
  } catch (err) {
    console.error("❌ showQrCode error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to fetch QR code' });
  }
}

// Kullanıcının satın aldığı eSIM'leri listele - GÜNCELLENMİŞ
export async function listUserPurchases(req, res) {
  try {
    const purchases = await db.Esim.findAll({ 
      where: { userId: req.session.user.id },
      order: [['createdAt', 'DESC']]
    });
    
    // Her purchase için güncel status'u kontrol et (opsiyonel - performans için)
    // Büyük listelerde bu yavaş olabilir, o yüzden sadece debug modunda çalıştırabiliriz
    if (process.env.NODE_ENV === 'development' && purchases.length <= 5) {
      console.log('🔄 Refreshing purchase statuses...');
      
      for (const purchase of purchases) {
        try {
          const apiStatus = await getPurchase(purchase.transactionId);
          if (purchase.status !== apiStatus.status) {
            await purchase.update({ status: apiStatus.status });
            console.log(`✅ Updated ${purchase.transactionId}: ${purchase.status} → ${apiStatus.status}`);
          }
        } catch (updateErr) {
          console.log(`⚠️ Could not update status for ${purchase.transactionId}:`, updateErr.message);
        }
      }
    }
    
    res.render('purchases', { 
      title: 'My Purchases', 
      purchases: purchases
    });
  } catch (err) {
    console.error("❌ listUserPurchases error:", err.message);
    res.render('error', { message: 'Failed to load purchases' });
  }
}