const pool = require('../config/database');

async function logAction(userId, action, esimId, details, req) {
  try {
    await pool.query(
      'INSERT INTO system_logs(user_id, action, esim_id, details, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId || null, action, esimId || null, details || null, req?.ip || null, req?.headers['user-agent'] || null]
    );
  } catch (err) {
    console.error('Failed to insert log:', err);
  }
}

module.exports = logAction;
