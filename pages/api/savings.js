import { calculateTotalSavings, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import {
  isJsonMode,
  readJsonCollection,
  writeJsonCollection,
  withGeneratedId,
  enforceJsonLimit,
  getMongoCollection
} from '../../lib/dataSource';

const COLLECTION_NAME = 'savings';

function getTotalSavingsInline(list = []) {
  return list.reduce((sum, item) => sum + (parseFloat(item?.จำนวนเงิน || item?.savings_amount || item?.amount || 0)), 0);
}

function enforceJsonMonthLimit(docs) {
  return enforceJsonLimit({
    docs,
    limit: 15,
    selector: (doc) => doc && doc.month
  });
}

async function handleJsonSavingsGet(req, res) {
  const docs = await readJsonCollection(COLLECTION_NAME);
  const { month } = req.query;
  if (month) {
    const doc = docs.find(d => d.month === month);
    const savingsList = doc && Array.isArray(doc.savings_list) ? doc.savings_list : [];
    const response = {
      total_savings: doc && typeof doc.total_savings === 'number' ? doc.total_savings : 0,
      savings_list: savingsList,
      รวมเงินเก็บ: getTotalSavingsInline(savingsList)
    };
    return res.status(200).json(response);
  }
  const data = {};
  docs.forEach(doc => {
    if (!doc || !doc.month) return;
    const savingsList = doc.savings_list || [];
    const totalSavings = calculateTotalSavings(savingsList);
    data[doc.month] = {
      total_savings: doc.total_savings || 0,
      savings_list: savingsList,
      totalSavings,
      รวมเงินเก็บ: getTotalSavingsInline(savingsList)
    };
  });
  return res.status(200).json(data);
}

async function handleJsonSavingsPost(req, res) {
  const { month, total_savings, savings_list } = req.body;
  if (!month) {
    return res.status(400).json({ error: 'month required' });
  }
  const docs = await readJsonCollection(COLLECTION_NAME);
  const idx = docs.findIndex(doc => doc.month === month);
  const updateObj = { month, savings_list };
  if (typeof total_savings !== 'undefined') {
    updateObj.total_savings = total_savings;
  }
  if (idx >= 0) {
    docs[idx] = { ...docs[idx], ...updateObj };
  } else {
    docs.push(withGeneratedId(updateObj));
  }
  const limited = enforceJsonMonthLimit(docs);
  await writeJsonCollection(COLLECTION_NAME, limited);
  return res.status(201).json({ success: true });
}

export default async function handler(req, res) {
  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonSavingsGet(req, res);
    }
    if (req.method === 'POST') {
      return handleJsonSavingsPost(req, res);
    }
    return res.status(405).end();
  }

  const collection = await getMongoCollection(COLLECTION_NAME);

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
    await enforceMonthLimit(collection, 15);
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}