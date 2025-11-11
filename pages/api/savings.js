import dbPromise from '../../lib/mongodb';
import { calculateTotalSavings } from '../../src/shared/utils/apiUtils';

export default async function handler(req, res) {
  const db = await dbPromise;
  const collection = db.collection('savings');

  if (req.method === 'GET') {
    const { month } = req.query;
      if (month) {
        const doc = await collection.findOne({ month });
        // Always return default structure if not found, to match legacy JSON behavior
        const savingsList = doc && Array.isArray(doc.savings_list) ? doc.savings_list : [];
        // คำนวณยอดรวมเงินเก็บ
        function getTotalSavings(list) {
          return list.reduce((sum, item) => sum + (parseFloat(item.จำนวนเงิน || item.savings_amount || item.amount || 0)), 0);
        }
        const รวมเงินเก็บ = getTotalSavings(savingsList);
        const response = {
          total_savings: doc && typeof doc.total_savings === 'number' ? doc.total_savings : 0,
          savings_list: savingsList,
          รวมเงินเก็บ
        };
        return res.status(200).json(response);
    } else {
      // ดึงข้อมูลทุกเดือน (robust: skip doc ที่ไม่มี month, log error, กัน exception)
      try {
        const allDocs = await collection.find({}).toArray();
        const data = {};
        allDocs.forEach(doc => {
          if (!doc || !doc.month) {
            console.error('[savings API] Skipping doc with missing month:', doc);
            return;
          }
          try {
            const savingsList = doc.savings_list || [];
            const totalSavings = calculateTotalSavings(savingsList);
            data[doc.month] = {
              total_savings: doc.total_savings || 0,
              savings_list: savingsList,
              totalSavings
            };
              // คำนวณยอดรวมเงินเก็บ
              function getTotalSavings(list) {
                return list.reduce((sum, item) => sum + (parseFloat(item.จำนวนเงิน || item.savings_amount || item.amount || 0)), 0);
              }
              const รวมเงินเก็บ = getTotalSavings(savingsList);
              data[doc.month].รวมเงินเก็บ = รวมเงินเก็บ;
          } catch (err) {
            console.error('[savings API] Error processing doc:', doc, err);
          }
        });
        return res.status(200).json(data);
      } catch (err) {
        console.error('[savings API] Error in getAll:', err);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
      }
    }
  } else if (req.method === 'POST') {
    const { month, total_savings, savings_list } = req.body;
    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }
    // สร้าง object สำหรับบันทึก โดยไม่ใส่ total_savings ถ้าไม่ได้ส่งมา
    const updateObj = { month, savings_list };
    if (typeof total_savings !== 'undefined') {
      updateObj.total_savings = total_savings;
    }
    await collection.updateOne(
      { month },
      { $set: updateObj },
      { upsert: true }
    );
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}