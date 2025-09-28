import db from '../db/models/index.js';
import bcrypt from 'bcrypt';

// Admin: kullanıcı listesini göster
export async function listUsers(req, res) {
  try {
    const users = await db.User.findAll({
      include: db.Esim,
      order: [['id', 'ASC']]
    });
    res.render('users', { title: 'Manage Users', users });
  } catch (err) {
    console.error("❌ listUsers error:", err.message);
    res.render('error', { message: 'Failed to load users' });
  }
}

// Admin: yeni kullanıcı ekle
export async function createUser(req, res) {
  try {
    const { username, password, esimLimit } = req.body;

    const hash = await bcrypt.hash(password, 10);

    await db.User.create({
      username,
      passwordHash: hash,
      isAdmin: false,
      esimLimit: esimLimit || null
    });

    res.redirect('/admin/users');
  } catch (err) {
    console.error("❌ createUser error:", err.message);
    res.render('error', { message: 'Failed to create user' });
  }
}
