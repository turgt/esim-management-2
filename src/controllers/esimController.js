import { v4 as uuidv4 } from 'uuid';
import { listOffers, purchaseEsim, getPurchase, getPurchaseQrCode } from '../services/zenditClient.js';
import db from '../db/models/index.js';
import cacheService from '../services/cacheService.js';

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
      offers: activeOffers,
      cached: offers === cacheService.getOffers(country)
    });
  } catch (err) {
    console.error("❌ showOffers error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to load offers' });
  }
}

// Satın alma işlemi - OPTIMIZED
export async function createPurchase(req, res) {
  const transaction = await db.sequelize.transaction();
  
  try {
    const { offerId } = req.body;
    const userId = req.session.user.id;
    
    // Use transaction for atomic operations
    const user = await db.User.findByPk(userId, { 
      include: db.Esim,
      transaction 
    });

    // Check limit
    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      return res.render('error', { message: 'eSIM limit reached' });
    }

    const transactionId = uuidv4();
    console.log(`🛒 Creating purchase - User: ${user.username}, Offer: ${offerId}, TX: ${transactionId}`);
    
    // API call
    const purchase = await purchaseEsim(offerId, transactionId);
    console.log(`✅ Purchase created with status: ${purchase.status}`);

    // Save to database
    await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: purchase.status || 'pending'
    }, { transaction });

    // Cache the initial status
    cacheService.setStatus(transactionId, purchase);
    
    // Invalidate user's purchase cache
    cacheService.invalidateUser(userId);

    await transaction.commit();
    res.redirect(`/status/${transactionId}`);
    
  } catch (err) {
    await transaction.rollback();
    console.error("❌ createPurchase error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to create purchase' });
  }
}

// Status with smart caching
export async function showStatus(req, res) {
  try {
    const txId = req.params.txId;
    const forceRefresh = req.query.refresh === 'true';
    
    console.log(`🔍 Checking status for transaction: ${txId} (force: ${forceRefresh})`);
    
    let apiStatus = null;
    
    // Try cache first (unless forced refresh)
    if (!forceRefresh) {
      apiStatus = cacheService.getStatus(txId);
    }
    
    // If not cached or forced refresh, fetch from API
    if (!apiStatus) {
      console.log('🌐 Fetching status from API...');
      apiStatus = await getPurchase(txId);
      cacheService.setStatus(txId, apiStatus);
    }
    
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
        
        // Invalidate related caches
        cacheService.invalidateUser(esimRecord.userId);
        cacheService.invalidateStatus(txId);
        
        statusUpdated = true;
        console.log(`✅ Status updated in database successfully`);
      } catch (updateError) {
        console.error(`❌ Failed to update database:`, updateError);
      }
    }
    
    // QR readiness check
    const isQrReady = ['completed', 'success', 'active', 'ready'].includes(
      apiStatus.status.toLowerCase()
    );
    
    console.log(`📱 QR Ready: ${isQrReady}`);
    
    res.render('status', { 
      title: 'Purchase Status', 
      status: apiStatus,
      isQrReady: isQrReady,
      dbStatus: esimRecord.status,
      statusUpdated: statusUpdated,
      cached: !forceRefresh && cacheService.getStatus(txId) !== null,
      updatedAt: new Date().toLocaleTimeString()
    });
    
  } catch (err) {
    console.error("❌ showStatus error:", err.response?.data || err.message);
    
    // Fallback to database
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
          isQrReady: ['completed', 'success', 'active'].includes(esimRecord.status.toLowerCase()),
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

// QR Code with caching
export async function showQrCode(req, res) {
  try {
    const txId = req.params.txId;
    console.log(`📱 Fetching QR code for transaction: ${txId}`);
    
    // Check cache first
    let qr = cacheService.getQrCode(txId);
    
    if (!qr) {
      // Verify status first
      const status = await getPurchase(txId);
      
      if (!['completed', 'success', 'active', 'ready'].includes(status.status.toLowerCase())) {
        return res.render('error', { 
          message: `QR code not ready yet. Current status: ${status.status}` 
        });
      }
      
      console.log('🌐 Fetching QR code from API...');
      qr = await getPurchaseQrCode(txId);
      cacheService.setQrCode(txId, qr);
    }
    
    res.render('qrcode', { 
      title: 'QR Code', 
      qr,
      cached: qr === cacheService.getQrCode(txId)
    });
  } catch (err) {
    console.error("❌ showQrCode error:", err.response?.data || err.message);
    res.render('error', { message: 'Failed to fetch QR code' });
  }
}

// Optimized purchases list
export async function listUserPurchases(req, res) {
  try {
    const userId = req.session.user.id;
    const forceRefresh = req.query.refresh === 'true';
    
    console.log(`📋 Loading purchases for user ${userId} (force: ${forceRefresh})`);
    
    let purchases = null;
    
    // Try cache first
    if (!forceRefresh) {
      purchases = cacheService.getUserPurchases(userId);
    }
    
    if (!purchases) {
      console.log('💾 Fetching purchases from database...');
      purchases = await db.Esim.findAll({ 
        where: { userId: userId },
        order: [['createdAt', 'DESC']],
        limit: 20 // Pagination - show last 20
      });
      
      cacheService.setUserPurchases(userId, purchases);
    }
    
    // Background status refresh for recent purchases
    if (purchases.length > 0 && purchases.length <= 3) {
      setImmediate(async () => {
        console.log('🔄 Background refresh of recent purchases...');
        
        for (const purchase of purchases.slice(0, 3)) {
          try {
            const apiStatus = await getPurchase(purchase.transactionId);
            if (purchase.status !== apiStatus.status) {
              await purchase.update({ status: apiStatus.status });
              cacheService.invalidateUser(userId);
              console.log(`✅ Background updated ${purchase.transactionId}: ${purchase.status} → ${apiStatus.status}`);
            }
          } catch (err) {
            console.log(`⚠️ Background update failed for ${purchase.transactionId}:`, err.message);
          }
        }
      });
    }
    
    res.render('purchases', { 
      title: 'My Purchases', 
      purchases: purchases,
      cached: !forceRefresh && cacheService.getUserPurchases(userId) !== null,
      lastRefresh: new Date().toLocaleTimeString()
    });
    
  } catch (err) {
    console.error("❌ listUserPurchases error:", err.message);
    res.render('error', { message: 'Failed to load purchases' });
  }
}