require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { ZenditApi } = require('@zenditplatform/zendit-sdk');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const zendit = new ZenditApi({
  apiKey: process.env.ZENDIT_API_KEY
});

app.get('/api/offers', async (req, res) => {
  try {
    const offers = await zendit.esimOffersGet(10, 0, null, 'TR');
    res.json(offers);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

app.post('/api/purchase', async (req, res) => {
  try {
    const { offerId, ...fields } = req.body;
    const transactionId = uuidv4();
    const purchase = await zendit.esimPurchasesPost({
      transactionId,
      offerId,
      ...fields
    });
    res.json(purchase);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to purchase' });
  }
});

app.get('/health', (req,res)=>res.json({status:'ok'}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
