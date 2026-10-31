# Vercel API budget

โปรเจกต์นี้กำหนดเพดาน Vercel Serverless Functions ไม่เกิน 12 ไฟล์ และปัจจุบันมี `api/*.js` ครบ 12 ไฟล์แล้ว

- ห้ามเพิ่มไฟล์ JavaScript ใหม่ในโฟลเดอร์นี้
- API หรือ action ใหม่ต้องรวมเข้ากับ router เดิมที่เกี่ยวข้อง เช่น `admin-actions.js`, `admin-coupons.js` หรือ `liff-guard.js`
- ใช้ query parameter หรือ request body `action` เพื่อแยก workflow ภายใน function เดิม
- ต้องรักษาการตรวจสิทธิ์, validation, idempotency, audit log และข้อความภาษาไทยของ workflow ใหม่ให้ครบ
- ก่อน commit ต้องรัน `npm test` ซึ่งมีตัวตรวจจำนวน `api/*.js` ไม่ให้เกิน 12 ไฟล์
