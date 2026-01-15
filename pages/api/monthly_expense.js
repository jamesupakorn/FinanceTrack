import { mapDocToFlatItemObjectWithTotals, removeSummaryFields, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import {
  isJsonMode,
  readJsonCollection,
  writeJsonCollection,
  withGeneratedId,
  enforceJsonLimit,
  getMongoCollection
} from '../../lib/dataSource';

const COLLECTION_NAME = 'monthly_expense';

function getExpenseTotals(expenseData) {
  let totalEstimate = 0;
  let totalActualPaid = 0;
  Object.values(expenseData || {}).forEach(item => {
    if (item && typeof item === 'object') {
      totalEstimate += parseFloat(item.estimate || 0);
      totalActualPaid += parseFloat(item.actual || 0);
    }
  });
  return {
    totalEstimate: Math.round(totalEstimate * 100) / 100,
    totalActualPaid: Math.round(totalActualPaid * 100) / 100
  };
}

function getAccountSummary(expenseData) {
  const mapping = {
    "กรุงศรี": ["credit_kungsri"],
    "ttb": ["house", "credit_ttb"],
    "กสิกร": ["credit_kbank", "shopee", "netflix", "youtube", "youtube_membership"],
    "UOB": ["credit_uob"]
  };
  const summary = {};
  Object.entries(mapping).forEach(([account, items]) => {
    let sum = 0;
    items.forEach(item => {
      const paid = expenseData[item]?.paid;
      if (paid !== true && paid !== 'true') {
        sum += parseFloat(expenseData[item]?.estimate || 0);
      }
    });
    summary[account] = sum;
  });
  return summary;
}

function enforceJsonMonthLimit(docs) {
  return enforceJsonLimit({
    docs,
    limit: 15,
    selector: (doc) => doc && doc.month
  });
}

async function handleJsonExpenseGet(req, res) {
  const docs = await readJsonCollection(COLLECTION_NAME);
  const { month } = req.query;
  if (month) {
    const doc = docs.find(d => d.month === month);
    if (!doc) return res.status(200).json({});
    let flat = mapDocToFlatItemObjectWithTotals(doc);
    flat.accountSummary = getAccountSummary(flat);
    const totals = getExpenseTotals(flat);
    flat.totalEstimate = totals.totalEstimate;
    flat.totalActualPaid = totals.totalActualPaid;
    return res.status(200).json(flat);
  }
  const withTotals = {};
  docs.forEach(doc => {
    if (!doc || !doc.month) return;
    let flat = mapDocToFlatItemObjectWithTotals(doc);
    flat.accountSummary = getAccountSummary(flat);
    const totals = getExpenseTotals(flat);
    flat.totalEstimate = totals.totalEstimate;
    flat.totalActualPaid = totals.totalActualPaid;
    withTotals[doc.month] = flat;
  });
  return res.status(200).json(withTotals);
}

async function handleJsonExpensePost(req, res) {
  const { month, expense_data } = req.body;
  if (!month || !expense_data) {
    return res.status(400).json({ error: 'month and expense_data required' });
  }
  const cleanData = removeSummaryFields(expense_data);
  const docs = await readJsonCollection(COLLECTION_NAME);
  const idx = docs.findIndex(doc => doc.month === month);
  if (idx >= 0) {
    docs[idx] = { ...docs[idx], ...cleanData, month };
  } else {
    docs.push(withGeneratedId({ ...cleanData, month }));
  }
  const limited = enforceJsonMonthLimit(docs);
  await writeJsonCollection(COLLECTION_NAME, limited);
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonExpenseGet(req, res);
    }
    if (req.method === 'POST') {
      return handleJsonExpensePost(req, res);
    }
    return res.status(405).end();
  }

  let collection;
  try {
    collection = await getMongoCollection(COLLECTION_NAME);
  } catch (err) {
    console.error('DB connection or collection error:', err);
    return res.status(500).json({ error: 'Database connection error' });
  }

  if (req.method === 'GET') {
    try {
      const { month } = req.query;

      if (month) {
        let doc;
        try {
          doc = await collection.findOne({ month });
        } catch (err) {
          console.error('Error fetching doc for month:', month, err);
          return res.status(500).json({ error: 'Database query error' });
        }
        if (!doc || typeof doc !== 'object') {
          console.error('No expense data found for this month:', month);
          return res.status(200).json({});
        }
        let flat;
        try {
          flat = mapDocToFlatItemObjectWithTotals(doc);
          console.log('Mapped flat doc for month', month, flat);
        } catch (err) {
          console.error('Error mapping expense doc for month:', month, err, doc);
          return res.status(200).json({});
        }
        if (!flat || Object.keys(flat).length === 0) {
          console.error('Malformed expense data for this month:', month, flat);
          return res.status(200).json({});
        }
        try {
          flat.accountSummary = getAccountSummary(flat);
        } catch (err) {
          console.error('Error in getAccountSummary:', month, err, flat);
          return res.status(500).json({ error: 'Error in account summary calculation' });
        }
        let totals;
        try {
          totals = getExpenseTotals(flat);
        } catch (err) {
          console.error('Error in getExpenseTotals:', month, err, flat);
          return res.status(500).json({ error: 'Error in expense totals calculation' });
        }
        try {
          flat.totalEstimate = totals.totalEstimate;
          flat.totalActualPaid = totals.totalActualPaid;
        } catch (err) {
          console.error('Error setting totals in flat:', month, err, flat, totals);
          return res.status(500).json({ error: 'Error setting totals in response' });
        }
        try {
          res.status(200).json(flat);
        } catch (err) {
          console.error('Error serializing response:', month, err, flat);
          return res.status(500).json({ error: 'Error serializing response' });
        }
      } else {
        const allDocs = await collection.find({}).toArray();
        const withTotals = {};
        allDocs.forEach(doc => {
          // ข้าม document ที่เป็น metadata หรือโครงสร้างไม่ถูกต้อง
          if (!doc || typeof doc !== 'object') return;
          if (!doc.month || doc.months || doc.items) return;
          let flat;
          try {
            flat = mapDocToFlatItemObjectWithTotals(doc);
          } catch (err) {
            console.error('Error mapping expense doc:', doc.month, err, doc);
            return;
          }
          if (!flat || Object.keys(flat).length === 0) return;
          flat.accountSummary = getAccountSummary(flat);
          const totals = getExpenseTotals(flat);
          flat.totalEstimate = totals.totalEstimate;
          flat.totalActualPaid = totals.totalActualPaid;
          withTotals[doc.month] = flat;
        });
        res.status(200).json(withTotals);
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to read monthly expense data' });
    }
  } else if (req.method === 'POST') {
    try {
      const { month, expense_data } = req.body;
      if (month && expense_data) {
        // ลบ field summary ก่อนบันทึก
        const cleanData = removeSummaryFields(expense_data);
        await collection.updateOne(
          { month },
          { $set: { ...cleanData, month } },
          { upsert: true }
        );
        await enforceMonthLimit(collection, 15);
        res.status(200).json({ success: true });
      } else {
        res.status(400).json({ error: 'month and expense_data required' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to write monthly expense data' });
    }
  } else {
    res.status(405).end();
  }
}
