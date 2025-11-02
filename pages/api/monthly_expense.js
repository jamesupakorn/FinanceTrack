import dbPromise from '../../lib/mongodb';

export default async function handler(req, res) {
  const db = await dbPromise;
  const collection = db.collection('monthly_expense');

  if (req.method === 'GET') {
    try {
      const { month } = req.query;
      // Helper: map legacy doc to {estimate, actual}
      function mapDocToFlatItemObjectWithTotals(doc) {
        if (!doc) return {};
        // If already in flat item format (e.g. house: {estimate, actual, paid})
        // or legacy months structure, just return as is
        if (doc.months) return doc;
        // If in {estimate: {...}, actual: {...}} format, convert to flat item object
        let out = {};
        if (doc.estimate && doc.actual) {
          const items = Array.from(new Set([...Object.keys(doc.estimate), ...Object.keys(doc.actual)]));
          items.forEach(key => {
            out[key] = {
              estimate: doc.estimate[key] ?? 0,
              actual: doc.actual[key] ?? 0,
              paid: false // paid info lost in this format
            };
          });
        } else {
          // Otherwise, treat all keys except 'month' and '_id' as items
          Object.keys(doc).forEach(key => {
            if (key === 'month' || key === '_id') return;
            const val = doc[key];
            if (val && typeof val === 'object') {
              out[key] = {
                estimate: val.estimate ?? 0,
                actual: val.actual ?? 0,
                paid: typeof val.paid === 'boolean' ? val.paid : false
              };
            }
          });
        }
        // Add summary fields for frontend chart
  const sumEstimate = Object.values(out).reduce((sum, v) => sum + (typeof v === 'object' && v.estimate ? parseFloat(v.estimate) || 0 : 0), 0);
  const sumActual = Object.values(out).reduce((sum, v) => sum + (typeof v === 'object' && v.actual ? parseFloat(v.actual) || 0 : 0), 0);
  out.totalEstimate = Math.round(sumEstimate * 100) / 100;
  out.totalActualPaid = Math.round(sumActual * 100) / 100;
        return out;
      }

      if (month) {
        const doc = await collection.findOne({ month });
        res.status(200).json(mapDocToFlatItemObjectWithTotals(doc));
      } else {
        // Return all months
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
        await collection.updateOne(
          { month },
          { $set: { ...expense_data, month } },
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
