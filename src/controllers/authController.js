const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.register = async (req,res) => {
  const { username, password, role } = req.body;
  try {
    const hashed = await bcrypt.hash(password,10);
    const result = await pool.query(
      'INSERT INTO users(username,password_hash,role) VALUES ($1,$2,$3) RETURNING id,username,role',
      [username, hashed, role || 'tenant']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Registration failed' });
  }
};

exports.login = async (req,res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username=$1 AND is_active=true',[username]);
    if (result.rows.length===0) return res.status(400).json({ error:'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error:'Invalid credentials' });

    const token = jwt.sign({ id:user.id, role:user.role }, process.env.JWT_SECRET, { expiresIn:'1d' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Login failed' });
  }
};
