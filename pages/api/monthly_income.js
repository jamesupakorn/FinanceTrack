import dbPromise from '../../lib/mongodb';
import { sumValues, removeSummaryFields } from '../../src/shared/utils/apiUtils';

export default async function handler(req, res) {
  const db = await dbPromise;
  const collection = db.collection('monthly_income');

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
      const รวม = sumValues(monthData, ['รวม']);
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
        const รวม = sumValues(monthData, ['รวม']);
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
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}