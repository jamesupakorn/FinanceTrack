import { mapInvestmentDoc, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import {
  isJsonMode,
  readJsonCollection,
  writeJsonCollection,
  withGeneratedId,
  enforceJsonLimit,
  getMongoCollection
} from '../../lib/dataSource';

const COLLECTION_NAME = 'investment';

function enforceJsonMonthLimit(docs) {
  return enforceJsonLimit({
    docs,
    limit: 15,
    selector: (doc) => doc && doc.month
  });
}

async function handleJsonInvestmentGet(req, res) {
  const docs = await readJsonCollection(COLLECTION_NAME);
  const { month } = req.query;
  if (month) {
    const doc = docs.find(d => d.month === month);
    return res.status(200).json(mapInvestmentDoc(doc));
  }
  const data = {};
  docs.forEach(doc => {
    if (!doc || !doc.month) return;
    data[doc.month] = mapInvestmentDoc(doc);
  });
  return res.status(200).json(data);
}

async function handleJsonInvestmentPost(req, res) {
  const { month, investments } = req.body;
  if (!month || !Array.isArray(investments)) {
    return res.status(400).json({ error: 'month and investments required' });
  }
  const docs = await readJsonCollection(COLLECTION_NAME);
  const idx = docs.findIndex(doc => doc.month === month);
  const payload = {
    month,
    investments
  };
  if (idx >= 0) {
    docs[idx] = { ...docs[idx], ...payload };
  } else {
    docs.push(withGeneratedId(payload));
  }
  const limited = enforceJsonMonthLimit(docs);
  await writeJsonCollection(COLLECTION_NAME, limited);
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonInvestmentGet(req, res);
    }
    if (req.method === 'POST') {
      return handleJsonInvestmentPost(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const collection = await getMongoCollection(COLLECTION_NAME);

  if (req.method === 'GET') {
    const { month } = req.query;
    if (month) {
      const doc = await collection.findOne({ month });
      return res.status(200).json(mapInvestmentDoc(doc));
    } else {
      // ดึงข้อมูลทุกเดือน
      const allDocs = await collection.find({}).toArray();
      const data = {};
      allDocs.forEach(doc => {
        data[doc.month] = mapInvestmentDoc(doc);
      });
      return res.status(200).json(data);
    }
  }
  if (req.method === 'POST') {
    const { month, investments } = req.body;
    if (!month || !Array.isArray(investments)) {
      return res.status(400).json({ error: 'month and investments required' });
    }
    await collection.updateOne(
      { month },
      { $set: { month, investments } },
      { upsert: true }
    );
    await enforceMonthLimit(collection, 15);
    return res.status(200).json({ success: true });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
