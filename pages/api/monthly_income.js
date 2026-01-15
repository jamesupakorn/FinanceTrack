import { sumValues, removeSummaryFields, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import {
  isJsonMode,
  readJsonCollection,
  writeJsonCollection,
  withGeneratedId,
  enforceJsonLimit,
  getMongoCollection
} from '../../lib/dataSource';

const MONTH_KEY_REGEX = /^\d{4}-\d{2}$/;

function getTotalIncome(data) {
  let sum = 0;
  Object.values(data || {}).forEach(v => {
    if (typeof v === 'number') sum += v;
  });
  return Math.round(sum * 100) / 100;
}

function buildJsonAllMonthsResponse(docs) {
  const data = {};
  docs.forEach(doc => {
    if (!doc || !doc.month) return;
    const monthData = { ...doc };
    delete monthData._id;
    const รวม = getTotalIncome(monthData);
    data[doc.month] = {
      ...monthData,
      รวม
    };
  });
  return data;
}

function enforceJsonMonthLimit(docs) {
  return enforceJsonLimit({
    docs,
    limit: 15,
    selector: (doc) => (doc && MONTH_KEY_REGEX.test(doc.month) ? doc.month : undefined)
  });
}

async function handleJsonGet(req, res) {
  const docs = await readJsonCollection('monthly_income');
  const { month } = req.query;
  if (month) {
    const doc = docs.find(item => item.month === month);
    if (!doc) {
      return res.status(200).json({});
    }
    const monthData = { ...doc };
    delete monthData._id;
    const รวม = getTotalIncome(monthData);
    return res.status(200).json({ month, ...monthData, รวม });
  }
  return res.status(200).json(buildJsonAllMonthsResponse(docs));
}

async function handleJsonPost(req, res) {
  const { month, values } = req.body;
  if (!month || !values) {
    return res.status(400).json({ error: 'month and values required' });
  }
  const cleanValues = removeSummaryFields(values, ['รวม']);
  const docs = await readJsonCollection('monthly_income');
  const idx = docs.findIndex(doc => doc.month === month);
  if (idx >= 0) {
    docs[idx] = { ...docs[idx], ...cleanValues, month };
  } else {
    docs.push(withGeneratedId({ ...cleanValues, month }));
  }
  const limitedDocs = enforceJsonMonthLimit(docs);
  await writeJsonCollection('monthly_income', limitedDocs);
  return res.status(201).json({ success: true });
}

export default async function handler(req, res) {
  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonGet(req, res);
    }
    if (req.method === 'POST') {
      return handleJsonPost(req, res);
    }
    return res.status(405).end();
  }

  const collection = await getMongoCollection('monthly_income');

  if (req.method === 'GET') {
    const { month } = req.query;
    if (month) {
      let doc = await collection.findOne({ month });
      if (!doc) {
        const monthsDoc = await collection.findOne({ obj: 'months' });
        if (monthsDoc && monthsDoc.months && monthsDoc.months[month]) {
          doc = { month, ...monthsDoc.months[month] };
        }
      }
      const monthData = doc ? { ...doc } : {};
      delete monthData._id;
        // คำนวณยอดรวมรายรับ
        function getTotalIncome(data) {
          let sum = 0;
          Object.values(data).forEach(v => {
            if (typeof v === 'number') sum += v;
          });
          return Math.round(sum * 100) / 100;
        }
        const รวม = getTotalIncome(monthData);
      const response = {
        month,
        ...monthData,
        รวม
      };
      return res.status(200).json(response);
    } else {
      const allDocs = await collection.find({ month: { $exists: true } }).toArray();
      const data = {};
      allDocs.forEach(doc => {
        const monthData = { ...doc };
        delete monthData._id;
          function getTotalIncome(data) {
            let sum = 0;
            Object.values(data).forEach(v => {
              if (typeof v === 'number') sum += v;
            });
            return Math.round(sum * 100) / 100;
          }
          const รวม = getTotalIncome(monthData);
        data[doc.month] = {
          ...monthData,
          รวม
        };
      });
      const monthsDoc = await collection.findOne({ obj: 'months' });
      if (monthsDoc && monthsDoc.months) {
        for (const [m, values] of Object.entries(monthsDoc.months)) {
          if (!data[m]) {
            data[m] = { month: m, ...values };
            data[m].รวม = sumValues(values, ['รวม']);
          }
        }
      }
      return res.status(200).json(data);
    }
  } else if (req.method === 'POST') {
    const { month, values } = req.body;
    if (!month || !values) {
      return res.status(400).json({ error: 'month and values required' });
    }
    const cleanValues = removeSummaryFields(values, ['รวม']);
    await collection.updateOne(
      { month },
      { $set: { ...cleanValues, month } },
      { upsert: true }
    );
    const monthsDoc = await collection.findOne({ obj: 'months' });
    const additionalMonths = monthsDoc && monthsDoc.months ? Object.keys(monthsDoc.months) : [];
    const { retainedMonths } = await enforceMonthLimit(collection, 15, { additionalMonths });
    if (monthsDoc && monthsDoc.months) {
      const prunedMonths = {};
      retainedMonths.forEach(m => {
        if (monthsDoc.months[m]) {
          prunedMonths[m] = monthsDoc.months[m];
        }
      });
      await collection.updateOne(
        { obj: 'months' },
        { $set: { months: prunedMonths } },
        { upsert: true }
      );
    }
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}