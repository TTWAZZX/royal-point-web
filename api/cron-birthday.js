const { supabaseAdmin } = require('../lib/supabase')

// ใส่ LINE Channel Access Token ของคุณที่นี่ (หรือใส่ใน .env จะปลอดภัยกว่า)
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "C6KcTxzglAJNBgmfwLu6PnjVJSZbxSE09O3pk81FZVxWuHOv0BLvHN44pRA81EikZUDf+omi6mKoq+12sVg2aqKpbhryNMvSBnTWawXgmwA1u+kHrA7DmtqaAvUQP/gKbVKJ2a4Hggwe8Un2Rd0CIQdB04t89/1O/w1cDnyilFU=";

module.exports = async (req, res) => {
  try {
    // 1. ตรวจสอบความปลอดภัย (Optional: เช็ค Secret Key เพื่อกันคนนอกกดเล่น)
    // if (req.query.key !== process.env.CRON_SECRET) return res.status(401).send('Unauthorized');

    const REWARD_AMOUNT = 100; // จำนวนแต้มที่จะแจก
    const currentYear = new Date().getFullYear();

    // 2. เรียก SQL แจกแต้ม
    const { data: users, error } = await supabaseAdmin.rpc('process_birthday_rewards', {
      p_amount: REWARD_AMOUNT,
      p_year: currentYear
    });

    if (error) throw error;

    if (!users || users.length === 0) {
      return res.status(200).json({ message: 'No birthdays today' });
    }

    // 3. ส่ง LINE ให้ทุกคนที่ได้รับรางวัล (Push Message)
    const results = await Promise.all(users.map(async (u) => {
      const lineUid = u.uid; // หรือ u.line_uid ตามที่ return มา
      if (!lineUid) return null;

      try {
        await fetch('https://api.line.me/v2/bot/message/push', {
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
                    url: "https://lh3.googleusercontent.com/d/1ENj4Y9AgaJBRSChfCoTm8YsN2lkSuFjC", // รูปเค้กสวยๆ
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
                        text: `สุขสันต์วันเกิดคุณ ${u.name || 'ลูกค้า'}`,
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
                          uri: "https://liff.line.me/2007053300-QoEvbXyn" // ใส่ LIFF Link ของคุณ
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