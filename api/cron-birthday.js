const { supabaseAdmin } = require('../lib/supabase')

// ✅ ดึง Token จาก Vercel (ปลอดภัยที่สุด)
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

module.exports = async (req, res) => {
  try {
    // ตรวจสอบว่ามี Token หรือยัง
    if (!LINE_ACCESS_TOKEN) {
      console.error("❌ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ในการตั้งค่า Vercel");
      return res.status(500).json({ error: "Server config error: Missing LINE Token" });
    }

    const REWARD_AMOUNT = 100; // จำนวนแต้มที่จะแจก
    const currentYear = new Date().getFullYear();

    // 1. เรียก SQL แจกแต้ม (Database Function)
    // ตรวจสอบให้แน่ใจว่าใน Supabase มีฟังก์ชัน 'process_birthday_rewards' แล้ว
    const { data: users, error } = await supabaseAdmin.rpc('process_birthday_rewards', {
      p_amount: REWARD_AMOUNT,
      p_year: currentYear
    });

    if (error) {
      console.error("Database RPC Error:", error);
      throw error;
    }

    if (!users || users.length === 0) {
      return res.status(200).json({ message: 'No birthdays today' });
    }

    // 2. ส่ง LINE Push Message ให้ทุกคนที่ได้รางวัล
    const results = await Promise.all(users.map(async (u) => {
      const lineUid = u.uid; 
      if (!lineUid) return null;

      try {
        const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            to: lineUid,
            messages: [
              {
                type: "flex",
                altText: "🎂 สุขสันต์วันเกิด! คุณได้รับคะแนนพิเศษ",
                contents: {
                  type: "bubble",
                  hero: {
                    type: "image",
                    url: "https://lh3.googleusercontent.com/d/1nxeogrQNzIO8Vv2L3g8HKBRCZ61W4TnK",
                    size: "full",
                    aspectRatio: "20:13",
                    aspectMode: "cover"
                  },
                  body: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        text: "HAPPY BIRTHDAY!",
                        weight: "bold",
                        size: "xl",
                        color: "#1DB446"
                      },
                      {
                        type: "text",
                        text: `สุขสันต์วันเกิดคุณ ${u.name || 'สมาชิก'}`,
                        margin: "md",
                        size: "md"
                      },
                      {
                        type: "text",
                        text: `จอห์นนี่ขอมอบ ${REWARD_AMOUNT} คะแนน เป็นของขวัญวันเกิด ขอให้มีความสุขและปลอดภัย นะครับ 🎉`,
                        wrap: true,
                        color: "#666666",
                        margin: "sm"
                      }
                    ]
                  },
                  footer: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "button",
                        action: {
                          type: "uri",
                          label: "เช็คคะแนนสะสม",
                          uri: "https://liff.line.me/2007053300-QoEvbXyn"
                        },
                        style: "primary",
                        color: "#1DB446"
                      }
                    ]
                  }
                }
              }
            ]
          })
        });
        if (!lineRes.ok) {
          const errBody = await lineRes.text();
          console.error(`LINE API error for ${lineUid}: ${lineRes.status}`, errBody);
          return { uid: lineUid, status: 'failed', code: lineRes.status };
        }
        return { uid: lineUid, status: 'sent' };
      } catch (err) {
        console.error(`Failed to send LINE to ${lineUid}`, err);
        return { uid: lineUid, status: 'failed' };
      }
    }));

    res.status(200).json({ 
      success: true, 
      processed: users.length, 
      details: results 
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}