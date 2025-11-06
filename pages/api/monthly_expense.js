import dbPromise from '../../lib/mongodb';
import { mapDocToFlatItemObjectWithTotals, removeSummaryFields } from '../../src/shared/utils/apiUtils';

export default async function handler(req, res) {
  const db = await dbPromise;
  const collection = db.collection('monthly_expense');

  if (req.method === 'GET') {
    try {
      const { month } = req.query;
      if (month) {
        const doc = await collection.findOne({ month });
        res.status(200).json(mapDocToFlatItemObjectWithTotals(doc));
      } else {
        const allDocs = await collection.find({}).toArray();
        const withTotals = {};
        allDocs.forEach(doc => {
          if (doc.month) {
            withTotals[doc.month] = mapDocToFlatItemObjectWithTotals(doc);
          }
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
