function uidList(value = '') {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function getAdminRole(uid = '') {
  const cleanUid = String(uid || '').trim()
  if (!cleanUid) return null
  if (cleanUid === process.env.ADMIN_UID) return 'super_admin'
  if (uidList(process.env.SAFETY_ADMIN_UIDS).includes(cleanUid)) return 'safety_admin'
  if (uidList(process.env.SAFETY_VIEWER_UIDS).includes(cleanUid)) return 'safety_viewer'
  return null
}

module.exports = { getAdminRole }
