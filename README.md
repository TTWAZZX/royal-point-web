# Royal Point Web

เอกสารนี้เป็นคู่มือหลักสำหรับพัฒนาและดูแลโปรเจกต์ Royal Point Web ต่อในอนาคต ครอบคลุมภาพรวมระบบ โครงสร้างไฟล์ environment variables, database migrations, API routes, admin tools, และฟีเจอร์ Enterprise Safety Check-in

## ภาพรวม

Royal Point Web เป็นเว็บแอปสำหรับสะสมแต้ม แลกของรางวัล ใช้คูปอง/QR code และมีระบบ Safety Check-in สำหรับองค์กร

ฟีเจอร์หลัก:

- User profile, tier, points, progress และ reward redemption
- QR/manual code redeem
- Admin console สำหรับจัดการคูปอง ของรางวัล แต้ม และ audit logs
- Daily Safety Check-in พร้อมคำถามแบบ dynamic
- Safety Pulse dashboard สำหรับแอดมิน
- AI Question Pack ใช้ Gemini สร้างคำถาม safety
- Monthly Safety Report และ CSV export
- Safety role guard, governance note, audit log และ streak reset ก่อน Go-live

## Tech Stack

- Frontend: plain HTML, CSS, JavaScript, Bootstrap, SweetAlert2, LIFF SDK
- Backend: Vercel Serverless Functions ในโฟลเดอร์ `api/`
- Database: Supabase Postgres
- Admin DB access: Supabase service role key
- Optional cache: Upstash Redis
- AI: Gemini API
- Deployment: Vercel

## โครงสร้างไฟล์สำคัญ

```text
.
├─ index.html                         # หน้า user หลัก
├─ app.js                             # logic หน้า user, reward, check-in, LIFF
├─ style.css                          # styling หลักทั้งหมด
├─ admin.html                         # หน้า Admin Console
├─ admin.js                           # logic admin console, safety dashboard, coupon admin
├─ admin.page.js                      # user/member admin table logic
├─ all-rewards.html                   # หน้าแสดงของรางวัลทั้งหมด
├─ loader.js                          # loading helpers
├─ vercel.json                        # Vercel rewrites + cron
├─ supabase_daily_checkins_migration.sql
├─ supabase_audit_logs_migration.sql
├─ lib/
│  ├─ supabase.js                     # Supabase admin client + Redis helper
│  └─ audit.js                        # audit log helper
└─ api/
   ├─ admin-actions.js                # admin API รวม reward/safety/audit
   ├─ admin-coupons.js                # coupon list/generate
   ├─ daily-checkin.js                # daily check-in + safety check-in
   ├─ rewards.js                      # rewards list
   ├─ redeem.js                       # redeem coupon/code
   ├─ spend.js                        # spend points for rewards
   ├─ get-score.js                    # user score
   ├─ score-history.js                # point/redemption history
   ├─ register.js                     # user registration
   ├─ all-scores.js                   # leaderboard/admin score listing
   ├─ liff-guard.js                   # LIFF guard
   └─ cron-birthday.js                # birthday cron
```

## Environment Variables

ตั้งค่าใน `.env.local` สำหรับ local และใน Vercel Environment Variables สำหรับ production

Required:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_UID=
```

Safety / AI:

```text
GEMINI_API_KEY=
SAFETY_ADMIN_UIDS=uid1,uid2
SAFETY_VIEWER_UIDS=uid3,uid4
```

Optional Redis:

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Notes:

- `ADMIN_UID` คือ super admin
- `SAFETY_ADMIN_UIDS` จัดการ Safety ได้ แต่ไม่ควรได้สิทธิ admin ทั้งระบบ
- `SAFETY_VIEWER_UIDS` ดู Safety dashboard/report ได้
- ห้าม commit `.env.local` หรือ secret ใดๆ

## Database Migrations

รัน SQL migration ใน Supabase SQL Editor:

1. `supabase_audit_logs_migration.sql`
2. `supabase_daily_checkins_migration.sql`

ตารางสำคัญจาก safety migration:

- `daily_checkins`
- `safety_questions`
- `safety_settings`

ฟิลด์สำคัญ:

- `daily_checkins.streak` ใช้เก็บวันสะสม
- `daily_checkins.safety_answer`, `safety_mood`, `risk_flag`, `risk_status` ใช้จัดกลุ่ม risk
- `safety_questions.options` เป็น JSONB เก็บ choice, answer code, answerText, mood, riskFlag
- `safety_settings.streak_reset_date` ใช้เริ่มนับ Safety Streak ใหม่โดยไม่ลบประวัติ

หลังเพิ่ม migration ใหม่ ให้ deploy API หลังจากรัน SQL แล้วเสมอ เพื่อเลี่ยง schema cache error

## API Routes

### User APIs

- `GET /api/get-score`
- `POST /api/register`
- `POST /api/redeem`
- `POST /api/spend`
- `GET /api/rewards`
- `GET /api/score-history`
- `GET|POST /api/daily-checkin`

### Admin APIs

- `GET|POST /api/admin-actions`
- `GET|POST /api/admin-coupons`
- `GET /api/admin-audit-logs` -> rewrite ไป `admin-actions?action=audit_logs`
- `POST /api/admin-coupons-generate` -> rewrite ไป `admin-coupons?action=generate`

### Vercel rewrites

ดูใน `vercel.json`

```json
{
  "source": "/api/admin-audit-logs",
  "destination": "/api/admin-actions?action=audit_logs"
}
```

## Safety Check-in Workflow

User flow:

1. ผู้ใช้กด `Safety Check-in`
2. ระบบโหลดคำถามประจำวันจาก `safety_questions`
3. ผู้ใช้เลือกหนึ่งใน 3 choices:
   - `ready`
   - `minor_risk`
   - `need_support`
4. ระบบบันทึก `daily_checkins`
5. ถ้ามี risk/support จะขึ้นใน Safety Pulse

Admin flow:

1. เปิด Admin Console -> Safety
2. ดู `Safety Pulse`
3. ใช้ tabs:
   - รอติดตาม
   - ยังไม่เช็คอิน
   - ความเสี่ยง
   - แผนก
   - ภาพรวม
4. ใช้ filters:
   - แผนก
   - สถานะเคส
   - ประเภทเคส
5. กดดูรายละเอียดเคสเพื่อดู timeline
6. กดรับทราบหรือปิดเคส

## AI Question Pack

Admin สามารถใช้ Gemini สร้างชุดคำถาม Safety ได้

หนึ่ง question pack จะมี:

- คำถาม
- 3 choices
- `answer` code สำหรับระบบ
- `answerText` สำหรับแอดมินอ่าน
- `mood`
- `riskFlag`

ข้อกำกับ prompt:

- non-punitive
- privacy-aware
- no blame
- no medical diagnosis
- ไม่ถามข้อมูลสุขภาพส่วนบุคคลละเอียดเกินจำเป็น
- ต้องออกคำถามตรงกับหัวข้อที่เลือกใน dropdown เช่น `ppe`, `chemical`, `ergonomics`, `environment`, `near_miss`
- API จะบังคับ `category` ของคำถามที่ AI ส่งกลับให้ตรงกับหัวข้อที่ admin เลือก
- API จะส่งคำถามเดิมใน `safety_questions` ให้ AI หลีกเลี่ยง และกรองคำถามซ้ำในชุดคำตอบก่อนส่งกลับ
- การบันทึกคำถามใหม่จะป้องกันคำถามซ้ำแบบข้อความเดียวกันหลัง normalize ช่องว่างและเครื่องหมายวรรคตอน

## Safety Check-in Gamification

ฟีเจอร์ใหม่เพื่อเพิ่มแรงจูงใจในการเช็คอิน:

### Weekly Calendar Dots

แสดง 7 วันของสัปดาห์ (จ-อา) ใต้ progress bar ภารกิจประจำสัปดาห์ วันที่เช็คอินแล้วจะเป็นสีเขียว วันปัจจุบันมีขอบสีน้ำเงิน ให้ผู้ใช้เห็นว่าเช็คอินวันไหนไปบ้างในสัปดาห์นี้

### Streak-at-Risk Warning

ถ้าผู้ใช้มี streak ≥ 2 วัน และยังไม่ได้เช็คอินวันนี้ และเหลือเวลาน้อยกว่า 2 ชั่วโมงก่อนสิ้นสุดรอบ ปุ่มเช็คอินจะกระพริบสีแดงเพื่อเตือน ระบบรองรับทั้งโหมดเปิด 24 ชั่วโมงและโหมดกำหนดช่วงเวลา

### Level-Up Celebration

เมื่อ Safety Streak ผ่านเกณฑ์ใหม่ จะขึ้น dialog พร้อม confetti:

| ระดับ | เกณฑ์ | Badge |
|-------|-------|-------|
| Safety Starter | 0–2 วัน | — |
| Bronze | 3–6 วัน | 🥉 |
| Silver | 7–14 วัน | 🥈 |
| Gold | 15–29 วัน | 🥇 |
| Champion | 30+ วัน | 🏆 |

### Daily Safety Tips

หลังเช็คอินแบบ `ready` ระบบจะสุ่มแสดง Tips ความปลอดภัยในที่ทำงาน 1 ข้อ จากคลัง 25 ข้อ

### Admin Safety Pulse — Streak Levels

หน้า Safety Pulse ของแอดมินแสดง badge ระดับ streak ของผู้ใช้แต่ละคน และมีสรุปจำนวนคนต่อระดับ (Overview card "Safety Streak Level")

## Reward Management Improvements

ฟีเจอร์เพิ่มเติมในหน้าจัดการของรางวัล (admin.html — tab ของรางวัล):

### B: Stock Validation (สต็อกไม่เกินขีดสูงสุด)

- กดปุ่ม `+` จะหยุดที่ `stock_max` พร้อมแจ้งเตือน toast ว่า "ถึงขีดสูงสุดแล้ว"
- backend `getSafeRewardData` ตัด stock เกิน stock_max ทิ้งอัตโนมัติเมื่อบันทึก

### C: Confirmation Dialogs (ยืนยันก่อนเปลี่ยนสถานะ)

- กด toggle เปิด/ปิดของรางวัล จะขึ้น Swal ขอยืนยันก่อน ถ้ากดยกเลิก toggle จะกลับสถานะเดิมทันที

### D: Stock Progress Bar (แถบแสดงสต็อก)

- การ์ดของรางวัลที่มี `stock_max > 0` จะแสดงแถบสีแสดงระดับสต็อก: เขียว (>50%), เหลือง (>20%), แดง (≤20%)
- อัปเดต real-time เมื่อกดปุ่ม +/-

### F: Redemption History per Reward (ประวัติการแลกรายของรางวัล)

- ปุ่ม "ประวัติ" ในการ์ดแต่ละชิ้น เปิด modal แสดงรายชื่อผู้แลก วันที่ แต้ม และสถานะ (รอ/อนุมัติ/ปฏิเสธ)
- ดึงข้อมูลจาก `get_history` action ใน admin-actions.js กรองตาม reward_id

### G: Duplicate Reward (ทำสำเนาของรางวัล)

- ปุ่ม copy icon ในหน้า edit modal ของรางวัล กดแล้ว clone ของรางวัลใหม่ชื่อ `(ชื่อเดิม) (สำเนา)` stock=0 active=false
- ไม่เพิ่มไฟล์ API ใหม่ ใช้ `reward_create` action เดิม

### H: Bulk Stock Refill (เติมสต็อกทั้งหมด)

- ปุ่ม "เติมสต็อกทั้งหมด" ด้านบนรายการ กดแล้วรีเซ็ตทุกรายการที่มี stock_max > 0 ให้เต็มสูงสุดพร้อมกัน
- มี Swal ยืนยันก่อน บอกจำนวนรายการที่จะถูกเติม

## Mobile UI Notes

- Safety Streak badge ในหน้าแรกจัด layout สำหรับจอเล็กให้ `จำนวนวัน` ลงแถวของตัวเอง เพื่อไม่ให้ข้อความ `Safety Starter` และคำอธิบาย streak ถูกบีบหรือตัดบรรทัดผิดรูปบนโทรศัพท์

## Safety Streak Reset

ใช้สำหรับช่วงทดสอบหรือก่อน Go-live เมื่อมีบางคนเข้ามาเล่นก่อนคนอื่น

แนวทางที่ใช้ในระบบ:

- ไม่ลบประวัติ `daily_checkins`
- ไม่ลบคะแนน
- ตั้ง `safety_settings.streak_reset_date`
- check-in หลังวัน reset จะเริ่มนับ streak ใหม่
- admin action ถูกบันทึก audit log

ใน Admin Console:

```text
Safety -> Streak Reset
```

เลือกวันที่เริ่มนับใหม่และใส่เหตุผล เช่น `reset-before-go-live`

## Monthly Safety Report

Admin Console มี Monthly Summary:

- Check-ins
- Average participation
- Risk cases
- Support cases
- Daily Trend
- Department Comparison
- Monthly CSV export

CSV รายเดือน export ผ่าน:

```text
exportMonthlySafetyCsv()
```

Daily pulse CSV ยังอยู่:

```text
exportSafetyPulseCsv()
```

## Audit Logs

Audit helper อยู่ที่:

```text
lib/audit.js
```

Safety actions ที่ audit แล้ว:

- `safety_question_create`
- `safety_question_update`
- `safety_question_archive`
- `safety_ai_generate_questions`
- `safety_risk_update`
- `safety_settings_update`
- `safety_streak_reset`

หมายเหตุ: `audit_logs` เป็น optional table ถ้า insert audit fail จะไม่ทำให้ user/admin flow พัง

### Audit Log UI (Thai labels + User names)

Admin Console แสดง audit log ด้วยภาษาไทย พร้อม icon และรายละเอียดที่อ่านง่าย แทน event code เดิม เช่น `daily_checkin_success` → "✅ เช็คอินความปลอดภัยสำเร็จ" และแสดงชื่อผู้ใช้แทน UID ทั้ง actor และ target (ดึง join จากตาราง `users` ใน `getAuditLogs` ใน admin-actions.js)

## Local Development

ติดตั้ง dependencies:

```bash
npm install
```

ตรวจ syntax:

```bash
node --check app.js
node --check admin.js
node --check api/admin-actions.js
node --check api/daily-checkin.js
```

ตรวจ diff:

```bash
git diff --check
git status --short
```

โปรเจกต์นี้ยังไม่มี `npm test` หรือ `npm run dev` ใน `package.json`

ถ้าจะใช้ Vercel local:

```bash
vercel login
vercel dev
```

ถ้าไม่มี credentials จะรัน `vercel dev` ไม่ได้

## Deployment Checklist

ก่อน deploy:

1. รัน Supabase migration ล่าสุด
2. ตรวจ Vercel env vars:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_UID`
   - `GEMINI_API_KEY`
   - `SAFETY_ADMIN_UIDS` ถ้ามี
   - `SAFETY_VIEWER_UIDS` ถ้ามี
3. รัน syntax checks
4. รัน `git diff --check`
5. Deploy ไป Vercel
6. Smoke test:
   - หน้า user เปิดได้
   - Admin Console เปิดได้
   - Daily Check-in ใช้ได้
   - Safety Pulse โหลดได้
   - AI Question Pack ใช้ได้
   - Monthly CSV export ได้

## Development Notes

- ระวังอย่าแก้ `.env.local` ลง git
- ถ้าเพิ่ม API ใหม่ ต้องเช็ก Vercel function limit ด้วย เพราะโปรเจกต์เคย consolidate routes ผ่าน `admin-actions.js`
- ถ้าเพิ่มข้อมูล safety ใหม่ ควรคิดเรื่อง audit log และ privacy note เสมอ
- ถ้าต้องเพิ่ม role/permission แบบจริงจังในอนาคต ควรย้ายจาก env vars ไปตาราง `admin_roles`
- ถ้าต้องการ timeline แบบละเอียด ควรเพิ่มตาราง `safety_case_events`

## Recommended Next Improvements

- เพิ่ม UI จัดการ safety roles แทน env vars
- เพิ่ม notification/escalation ไป LINE, Slack หรือ email
- เพิ่ม duplicate detection ก่อนบันทึก AI question pack
- เพิ่ม `safety_case_events` สำหรับ note/action history แบบถาวร
- เพิ่ม automated tests สำหรับ `daily-checkin` และ `admin-actions`
