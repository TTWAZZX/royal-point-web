const crypto = require('node:crypto')
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

function productionAdminUrl() {
  const base = String(process.env.LINE_ADMIN_URL || process.env.APP_BASE_URL || '').trim()
  if (!base) return 'https://royal-point-web-rfzt.vercel.app/admin.html'
  const url = new URL(base)
  if (!/admin\.html$/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, '')}/admin.html`
  return url.toString()
}

async function main() {
  loadLocalEnv()
  const accessToken = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
  const adminUid = String(process.env.ADMIN_UID || '').trim()
  if (!accessToken || !adminUid) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ ADMIN_UID')

  const timestamp = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date())
  const message = {
    type: 'flex',
    altText: 'ทดสอบระบบแจ้งเตือนศูนย์ช่วยเหลือ Royal Point สำเร็จ',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#ECFDF5', paddingAll: '20px',
        contents: [
          { type: 'text', text: 'ทดสอบ Flex Message สำเร็จ', color: '#047857', weight: 'bold', size: 'xl', wrap: true },
          { type: 'text', text: 'ศูนย์ช่วยเหลือการเข้าสู่ระบบ Royal Point', color: '#065F46', size: 'sm', margin: 'sm', wrap: true }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: 'ข้อความนี้ส่งจากระบบ Production เพื่อยืนยันว่า LINE Messaging API และ Flex Message ทำงานจริง', color: '#334155', size: 'sm', wrap: true },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: `ทดสอบเมื่อ ${timestamp}`, color: '#64748B', size: 'xs', margin: 'lg', wrap: true }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [{
          type: 'button', style: 'primary', color: '#059669', height: 'sm',
          action: { type: 'uri', label: 'เปิดหน้าผู้ดูแล', uri: productionAdminUrl() }
        }]
      }
    }
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Line-Retry-Key': crypto.randomUUID()
    },
    body: JSON.stringify({ to: adminUid, messages: [message] })
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || `LINE HTTP ${response.status}`)
  process.stdout.write(`LINE รับข้อความทดสอบแล้ว (request id: ${response.headers.get('x-line-request-id') || 'ไม่ระบุ'})\n`)
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
