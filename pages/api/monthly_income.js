import dbPromise from '../../lib/mongodb';

export default async function handler(req, res) {
  const db = await dbPromise;
  const collection = db.collection('monthly_income');

  if (req.method === 'GET') {
    const { month } = req.query;
    if (month) {
      // Try to find direct month doc first
      let doc = await collection.findOne({ month });
      if (!doc) {
        // fallback: หาใน obj: 'months'
        const monthsDoc = await collection.findOne({ obj: 'months' });
        if (monthsDoc && monthsDoc.months && monthsDoc.months[month]) {
          doc = { month, ...monthsDoc.months[month] };
        }
      }
      const monthData = doc ? { ...doc } : {};
      delete monthData._id;
      const รวม = Object.entries(monthData)
        .filter(([key, v]) => typeof v === 'number' && key !== 'รวม')
        .reduce((sum, [, value]) => sum + (parseFloat(value) || 0), 0);
      const response = {
        month,
        ...monthData,
        รวม
      };
      return res.status(200).json(response);
    } else {
      // ดึงข้อมูลทุกเดือน (เฉพาะ doc ที่มี month จริง)
      const allDocs = await collection.find({ month: { $exists: true } }).toArray();
      const data = {};
      allDocs.forEach(doc => {
        const monthData = { ...doc };
        delete monthData._id;
        const รวม = Object.entries(monthData)
          .filter(([key, v]) => typeof v === 'number' && key !== 'รวม')
          .reduce((sum, [, value]) => sum + (parseFloat(value) || 0), 0);
        data[doc.month] = {
          ...monthData,
          รวม
        };
      });
      // fallback: ถ้ายังไม่มี months ครบ ลองเติมจาก obj: 'months'
      const monthsDoc = await collection.findOne({ obj: 'months' });
      if (monthsDoc && monthsDoc.months) {
        for (const [m, values] of Object.entries(monthsDoc.months)) {
          if (!data[m]) {
            data[m] = { month: m, ...values };
            data[m].รวม = Object.entries(values).filter(([key, v]) => typeof v === 'number' && key !== 'รวม').reduce((sum, [, value]) => sum + (parseFloat(value) || 0), 0);
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
    // Remove field 'รวม' if present
    if ('รวม' in values) delete values['รวม'];
    await collection.updateOne(
      { month },
      { $set: { ...values, month } },
      { upsert: true }
    );
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}