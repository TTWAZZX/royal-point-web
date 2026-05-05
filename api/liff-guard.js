module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  return res.status(410).json({
    status: 'error',
    message: 'liff-guard is a browser helper and is not available as an API endpoint'
  });
};
