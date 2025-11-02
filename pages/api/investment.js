import dbPromise from '../../lib/mongodb';

export default async function handler(req, res) {
  const db = await dbPromise;
  const collection = db.collection('investment');

  if (req.method === 'GET') {
    const { month } = req.query;
    if (month) {
      const doc = await collection.findOne({ month });
      return res.status(200).json(doc ? doc.investments || [] : []);
    } else {
      // ดึงข้อมูลทุกเดือน
      const allDocs = await collection.find({}).toArray();
      const data = {};
      allDocs.forEach(doc => {
        data[doc.month] = doc.investments || [];
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
    return res.status(200).json({ success: true });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
