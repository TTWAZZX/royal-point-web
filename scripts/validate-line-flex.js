const fs = require('node:fs')
const path = require('node:path')

function loadLocalEnv() {
  const file = path.resolve(__dirname, '..', '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

async function main() {
  loadLocalEnv()
  const accessToken = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
  if (!accessToken) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN')

  const {
    buildAdminHelpMessage,
    buildRecoveryApprovedMessage,
    buildRecoverySuccessMessage
  } = require('../lib/line-messaging')
  const helpCase = {
    id: 7,
    case_no: 'HELP-20261031-TEST01',
    target_uid: 'U12345678901234567890123456789012',
    error_code: 'AUTH_TOKEN_INVALID',
    request_count: 2,
    last_requested_at: new Date().toISOString(),
    recovery_until: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  }
  const user = { name: 'ผู้ใช้ทดสอบระบบ' }
  const messages = [
    buildAdminHelpMessage({ helpCase, user, url:'https://example.com/admin.html?helpCase=7' }),
    buildRecoveryApprovedMessage({ helpCase, user, url:'https://liff.line.me/1234567890-AbcdEfgh?recovery_ticket=test' }),
    buildRecoverySuccessMessage({ helpCase, user, url:'https://liff.line.me/1234567890-AbcdEfgh' }),
    buildRecoverySuccessMessage({ helpCase, user, admin:true, url:'https://example.com/admin.html?helpCase=7' })
  ]

  const response = await fetch('https://api.line.me/v2/bot/message/validate/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messages })
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new Error(result.message || `LINE validation failed with HTTP ${response.status}`)
  }
  process.stdout.write('LINE ยืนยันว่า Flex Message ทั้ง 4 รูปแบบถูกต้อง\n')
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
