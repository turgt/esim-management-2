const pool = require('../config/database');

exports.listUsers = async (req,res) => {
  try {
    const result = await pool.query('SELECT id,username,role,is_active,company_name FROM users ORDER BY id');
    res.json(result.rows);
  } catch(err) {
    console.error(err);
    res.status(500).json({error:'Failed to fetch users'});
  }
};
