import { v4 as uuidv4 } from 'uuid';
import { listOffers, purchaseEsim, getPurchase, getPurchaseQrCode } from '../services/zenditClient.js';
import db from '../db/models/index.js';
import cacheService from '../services/cacheService.js';

// QR ready status constants
const QR_READY_STATUSES = ['completed', 'success', 'active', 'ready', 'done'];

// Helper function to check if QR is ready
function isQrReady(status) {
  return QR_READY_STATUSES.includes(status.toLowerCase());
}

// Teklifleri listele - CACHED
export async function showOffers(req, res) {
  try {
    const country = process.env.COUNTRY || 'TR';
    
    // Check cache first
    let offers = cacheService.getOffers(country);
    
    if (!offers) {
      console.log('🌐 Fetching offers from API...');
      offers = await listOffers(country);
      cacheService.setOffers(country, offers);
    }

    const activeOffers = offers.list.filter(o => o.enabled);
    
    res.render('offers', { 
      title: 'Offers', 
      offers: activeOffers
    });
  } catch (err) {
    console.error("❌ showOffers error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to load offers' });
  }
}

// Satın alma işlemi
export async function createPurchase(req, res) {
  const transaction = await db.sequelize.transaction();
  
  try {
    const { offerId } = req.body;
    const userId = req.session.user.id;
    
    // Get user with eSIMs
    const user = await db.User.findByPk(userId, { 
      include: db.Esim,
      transaction 
    });

    // Check eSIM limit
    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      return res.render('error', { message: 'eSIM limit reached' });
    }

    const transactionId = uuidv4();
    console.log(`🛒 Creating purchase - User: ${user.username}, Offer: ${offerId}, TX: ${transactionId}`);
    
    // Call Zendit API
    const purchase = await purchaseEsim(offerId, transactionId);
    console.log(`✅ Purchase created with status: ${purchase.status}`);

    // Save to database
    await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: purchase.status || 'pending'
    }, { transaction });

    await transaction.commit();
    res.redirect(`/status/${transactionId}`);
    
  } catch (err) {
    await transaction.rollback();
    console.error("❌ createPurchase error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to create purchase' });
  }
}

// Status sayfası - Her zaman fresh API call
export async function showStatus(req, res) {
  try {
    const txId = req.params.txId;
    
    console.log(`🔍 Checking status for transaction: ${txId}`);
    
    // Always fetch fresh status from API
    console.log('🌐 Fetching status from API...');
    const apiStatus = await getPurchase(txId);
    
    // Find database record
    const esimRecord = await db.Esim.findOne({ 
      where: { transactionId: txId },
      include: [{
        model: db.User,
        attributes: ['id', 'username']
      }]
    });
    
    if (!esimRecord) {
      console.error(`❌ eSIM record not found for transaction: ${txId}`);
      return res.render('error', { message: 'eSIM record not found in database' });
    }
    
    console.log(`💾 Database Status: ${esimRecord.status}`);
    console.log(`📡 API Status: ${apiStatus.status}`);
    
    // Update database if status changed
    let statusUpdated = false;
    if (esimRecord.status !== apiStatus.status) {
      console.log(`🔄 Updating status: ${esimRecord.status} → ${apiStatus.status}`);
      
      try {
        await esimRecord.update({
          status: apiStatus.status
        });
        
        statusUpdated = true;
        console.log(`✅ Status updated in database successfully`);
      } catch (updateError) {
        console.error(`❌ Failed to update database:`, updateError);
      }
    }
    
    // Check if QR is ready
    const qrReady = isQrReady(apiStatus.status);
    console.log(`📱 QR Ready: ${qrReady}`);
    
    res.render('status', { 
      title: 'Purchase Status', 
      status: apiStatus,
      isQrReady: qrReady,
      dbStatus: esimRecord.status,
      statusUpdated: statusUpdated,
      updatedAt: new Date().toLocaleTimeString()
    });
    
  } catch (err) {
    console.error("❌ showStatus error:", err.response?.data || err.message);
    
    // Fallback to database if API fails
    try {
      const esimRecord = await db.Esim.findOne({ 
        where: { transactionId: req.params.txId }
      });
      
      if (esimRecord) {
        console.log(`⚠️ API failed, showing database status: ${esimRecord.status}`);
        return res.render('status', {
          title: 'Purchase Status',
          status: {
            transactionId: esimRecord.transactionId,
            offerId: esimRecord.offerId,
            status: esimRecord.status,
            statusMessage: 'Status from database (API temporarily unavailable)'
          },
          isQrReady: isQrReady(esimRecord.status),
          dbStatus: esimRecord.status,
          apiError: true
        });
      }
    } catch (dbErr) {
      console.error("❌ Database fallback also failed:", dbErr);
    }
    
    res.render('error', { message: 'Failed to fetch status' });
  }
}

// QR Code sayfası - Her zaman fresh API call
export async function showQrCode(req, res) {
  try {
    const txId = req.params.txId;
    console.log(`📱 Fetching QR code for transaction: ${txId}`);
    
    // Always fetch fresh status and QR from API
    const apiStatus = await getPurchase(txId);
    console.log(`📡 API Status for QR: ${apiStatus.status}`);
    
    if (!isQrReady(apiStatus.status)) {
      return res.render('error', { 
        message: `QR code not ready yet. Current status: ${apiStatus.status}` 
      });
    }
    
    console.log('🌐 Fetching QR code from API...');
    const qr = await getPurchaseQrCode(txId);
    
    // Check if user has permission
    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId },
      include: [{
        model: db.User,
        attributes: ['id', 'username']
      }]
    });
    
    // Verify user owns this eSIM
    if (!esimRecord || esimRecord.userId !== req.session.user.id) {
      return res.render('error', { 
        message: 'You do not have permission to access this QR code' 
      });
    }
    
    res.render('qrcode', { 
      title: 'QR Code', 
      qr,
      esim: esimRecord
    });
    
  } catch (err) {
    console.error("❌ showQrCode error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to fetch QR code' });
  }
}

// Kullanıcının satın aldığı eSIM'leri listele
export async function listUserPurchases(req, res) {
  try {
    const userId = req.session.user.id;
    
    console.log(`📋 Loading purchases for user ${userId}`);
    
    // Always fetch fresh from database
    const purchases = await db.Esim.findAll({ 
      where: { userId: userId },
      order: [['createdAt', 'DESC']],
      limit: 20
    });
    
    res.render('purchases', { 
      title: 'My Purchases', 
      purchases: purchases
    });
    
  } catch (err) {
    console.error("❌ listUserPurchases error:", err.message);
    res.render('error', { message: 'Failed to load purchases' });
  }
}