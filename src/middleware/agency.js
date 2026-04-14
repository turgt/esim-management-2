export function ensureAgency(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (!req.session.user.agencyId) {
    return res.status(403).render('error', {
      title: 'Error',
      user: req.session.user,
      message: 'Bu sayfa sadece acente kullanicilari icindir.'
    });
  }
  return next();
}

export function ensureAgencyOwner(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (!req.session.user.agencyId || req.session.user.agencyRole !== 'owner') {
    return res.status(403).render('error', {
      title: 'Error',
      user: req.session.user,
      message: 'Bu islem sadece acente yoneticileri tarafindan yapilabilir.'
    });
  }
  return next();
}
