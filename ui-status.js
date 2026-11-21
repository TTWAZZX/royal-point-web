(function () {
  const statuses = {
    redemption: {
      legacy: ['ประวัติเก่า', 'neutral'],
      approved: ['รอรับรางวัล', 'waiting'],
      received: ['รับรางวัลแล้ว', 'success'],
      cancelled_refunded: ['ยกเลิกและคืนคะแนนแล้ว', 'info'],
      pending: ['รอตรวจผลการแลก', 'waiting']
    },
    delivery: {
      sent: ['ส่ง LINE แล้ว', 'success'],
      failed: ['ส่ง LINE ไม่สำเร็จ', 'danger'],
      pending: ['รอส่ง LINE', 'waiting'],
      missing: ['ยังไม่มีข้อมูลการส่ง LINE', 'neutral']
    },
    migration: {
      legacy: ['รอย้ายระบบ', 'neutral'],
      verified: ['ยืนยันผ่าน LINE แล้ว', 'success'],
      recovery: ['โหมดช่วยเหลือ', 'waiting']
    },
    help: {
      open: ['รอดำเนินการ', 'waiting'],
      approved: ['เปิดโหมดช่วยเหลือแล้ว', 'info'],
      resolved: ['แก้ไขแล้ว', 'success'],
      expired: ['หมดอายุ', 'neutral'],
      closed: ['ปิดเรื่อง', 'neutral']
    },
    coupon: {
      unused: ['ยังไม่ได้ใช้', 'success'],
      used: ['ใช้แล้ว', 'neutral'],
      cancelled: ['ยกเลิกแล้ว', 'danger']
    },
    reward: {
      sold_out: ['หมดแล้ว', 'danger']
    },
    safety: {
      new: ['เคสใหม่', 'waiting'],
      acknowledged: ['รับทราบแล้ว', 'info'],
      resolved: ['ปิดเคสแล้ว', 'success'],
      none: ['รอตรวจสอบ', 'neutral']
    }
  };
  const spendErrors = {
    insufficient_points: 'คะแนนไม่พอสำหรับแลกรางวัลนี้',
    out_of_stock: 'รางวัลนี้หมดแล้ว กรุณาเลือกรางวัลอื่น',
    stock_conflict: 'รางวัลนี้เพิ่งถูกแลกหมด กรุณาโหลดหน้าใหม่อีกครั้ง',
    reward_inactive: 'รางวัลนี้ปิดให้แลกชั่วคราว',
    reward_not_found: 'ไม่พบข้อมูลรางวัลนี้',
    request_id_required: 'กรุณาตรวจประวัติการแลก แล้วโหลดหน้าใหม่ก่อนลองอีกครั้ง',
    request_id_conflict: 'คำขอเดิมไม่ตรงกับรายการนี้ กรุณาตรวจประวัติการแลกก่อนลองอีกครั้ง',
    user_not_found: 'ไม่พบข้อมูลผู้ใช้ กรุณาเปิดหน้าแรกผ่าน LINE อีกครั้ง',
    'uid & rewardId required': 'ข้อมูลผู้ใช้หรือรางวัลไม่ครบ กรุณาลองใหม่'
  };

  function ownValue(entries, key) {
    return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : undefined;
  }

  function get(group, status) {
    const [label, tone] = ownValue(ownValue(statuses, group) || {}, status) || ['ไม่ทราบสถานะ', 'neutral'];
    return { label, tone };
  }

  function badge(group, status) {
    const { label, tone } = get(group, status);
    return `<span class="rp-status rp-status--${tone}">${label}</span>`;
  }

  function spendError(err) {
    const code = String(err?.message || err?.status || err || '');
    const message = ownValue(spendErrors, code) || 'ยังยืนยันผลการแลกไม่ได้ กรุณาตรวจประวัติหรือส่งคำขอเดิมอีกครั้ง';
    return err?.correlationId ? `${message} · เลขอ้างอิง ${err.correlationId}` : message;
  }

  const ui = { get, badge, spendError };
  if (typeof module === 'object' && module.exports) module.exports = ui;
  else window.RoyalStatus = ui;
})();
