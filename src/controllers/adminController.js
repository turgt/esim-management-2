const pool = require('../config/database');

exports.systemStats = async (req,res) => {
  try {
    const result = await pool.query('SELECT get_system_stats() as stats');
    res.json(result.rows[0].stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Failed to fetch stats' });
  }
};

exports.viewLogs = async (req,res) => {
  try {
    const result = await pool.query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Failed to fetch logs' });
  }
};
