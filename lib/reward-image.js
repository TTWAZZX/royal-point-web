function rewardImageAllowedHosts() {
  const hosts = new Set([
    'placehold.co',
    'lh3.googleusercontent.com',
    ...String(process.env.REWARD_IMAGE_ALLOWED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  ])
  try {
    const supabaseHost = new URL(process.env.SUPABASE_URL || '').hostname.toLowerCase()
    if (supabaseHost) hosts.add(supabaseHost)
  } catch (_) {}
  return hosts
}

function safeRewardImageUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || !rewardImageAllowedHosts().has(host)) return null
    return url.toString()
  } catch (_) {
    return null
  }
}

module.exports = { rewardImageAllowedHosts, safeRewardImageUrl }
