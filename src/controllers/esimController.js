const pool = require('../config/database');
const zendit = require('../utils/zendit');
const logAction = require('../middleware/logger');

exports.listOffers = async (req,res) => {
  try {
    const { data } = await zendit.listOffers();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Failed to list offers' });
  }
};

exports.purchaseEsim = async (req,res) => {
  const tenantId = req.user.id;
  const { offerId } = req.body;
  try {
    // Check daily limit
    const check = await pool.query('SELECT check_daily_limit($1) as result',[tenantId]);
    const checkResult = check.rows[0].result;
    if (!checkResult.allowed) {
      return res.status(400).json(checkResult);
    }

    const { data } = await zendit.purchaseEsim({ offerId });
    await pool.query(
      'INSERT INTO esim_packages(tenant_id,gb_limit,country,status,zendit_transaction_id) VALUES ($1,$2,$3,$4,$5)',
      [tenantId, data.offer?.gb_limit || 0, data.offer?.country || 'TR','pending', data.id]
    );

    await logAction(tenantId,'PURCHASE_ESIM',null,`Offer ${offerId}`,req);
    res.json(data);
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error:'Purchase failed' });
  }
};
