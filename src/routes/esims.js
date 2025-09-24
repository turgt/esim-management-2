const express = require('express');
const { listOffers, purchaseEsim } = require('../controllers/esimController');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/offers', auth, listOffers);
router.post('/purchase', auth, purchaseEsim);

module.exports = router;
const zendit = require('../utils/zendit');

router.get('/qrcode/:id', auth, async (req,res) => {
  try {
    const { data } = await zendit.getTransactionQRCode(req.params.id);
    // assume response is image data
    res.setHeader('Content-Type','image/png');
    res.send(Buffer.from(data,'base64'));
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error:'Failed to fetch QR code' });
  }
});
