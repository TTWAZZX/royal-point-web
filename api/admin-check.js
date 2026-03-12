module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' })
  }

  const { uid } = req.query
  if (!uid || !process.env.ADMIN_UID) {
    return res.json({ isAdmin: false })
  }

  return res.json({ isAdmin: uid === process.env.ADMIN_UID })
}
