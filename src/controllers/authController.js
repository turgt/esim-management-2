import db from '../db/models/index.js';
import bcrypt from 'bcrypt';

export async function showLogin(req, res) {
  // Her zaman error gönderiyoruz (null olabilir)
  res.render('login', { title: 'Login', error: null });
}

export async function login(req, res) {
  const { username, password } = req.body;
  const user = await db.User.findOne({ where: { username } });

  if (user && await bcrypt.compare(password, user.passwordHash)) {
    req.session.user = { id: user.id, username: user.username, isAdmin: user.isAdmin };
    res.redirect('/offers');
  } else {
    res.render('login', { title: 'Login', error: 'Invalid username or password' });
  }
}

export async function logout(req, res) {
  req.session.destroy(() => res.redirect('/auth/login'));
}
