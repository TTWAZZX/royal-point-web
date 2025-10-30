// lib/admin-auth.js (CJS)
module.exports = function requireAdmin(req, res) {
  const tok =
    req.headers['x-admin-token'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  if (!tok || tok !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ status: 'error', code: 'forbidden', message: 'Forbidden' });
    return false;
  }
  return true;
};
