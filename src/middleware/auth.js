export function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  // Force password change if using default password (allow profile and logout)
  if (req.session.user.mustChangePassword && !req.originalUrl.startsWith('/profile') && !req.originalUrl.startsWith('/auth/')) {
    // Block non-GET requests entirely (prevent API abuse with default password)
    if (req.method !== 'GET') {
      return res.status(403).json({ error: 'Password change required before performing actions' });
    }
    return res.redirect('/profile?changePassword=1');
  }
  return next();
}

export function ensureAdmin(req, res, next) {
  if (req.session.user && req.session.user.isAdmin) {
    return next();
  }
  res.status(403).render('error', { message: 'Forbidden: Admins only' });
}

export function ensureVendor(req, res, next) {
  if (req.session.user && req.session.user.isVendor) {
    return next();
  }
  res.status(403).render('error', { message: 'Forbidden: Vendor access required' });
}
