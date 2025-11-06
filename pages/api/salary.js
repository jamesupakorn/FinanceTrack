import dbPromise from '../../lib/mongodb';
import { calculateSalarySummary } from '../../src/shared/utils/apiUtils';

function createDefaultSalaryStructure() {
	return {
		income: {
			salary: 0,
			overtime_1x: 0,
			overtime_1_5x: 0,
			overtime_2x: 0,
			overtime_3x: 0,
			overtime_other: 0,
			bonus: 0,
			other_income: 0
		},
		deduct: {
			provident_fund: 0,
			social_security: 0,
			tax: 0
		},
		summary: {
			total_income: 0,
			total_deduct: 0,
			net_income: 0
		},
		saved_at: new Date().toISOString(),
		note: ""
	};
}

export default async function handler(req, res) {
	const db = await dbPromise;
	const collection = db.collection('salary');

	try {
		if (req.method === 'GET') {
			const { month } = req.query;
			if (month) {
				let doc = await collection.findOne({ month });
				if (!doc) {
					doc = createDefaultSalaryStructure();
					doc.month = month;
					await collection.insertOne({ ...doc });
				} else {
					// fallback income/deduct เป็น default ถ้าไม่มี
					if (!doc.income || Object.keys(doc.income).length === 0 || !doc.deduct || Object.keys(doc.deduct).length === 0) {
						doc = createDefaultSalaryStructure();
						doc.month = month;
						await collection.updateOne({ month }, { $set: { ...doc } });
					}
				}
				const summary = calculateSalarySummary(doc);
				return res.json({
					...doc,
					summary
				});
			} else {
				// return all
				const allDocs = await collection.find({}).toArray();
				const allData = {};
				allDocs.forEach(doc => {
					allData[doc.month] = doc;
				});
				return res.json(allData);
			}
		} else if (req.method === 'POST') {
			const { month, income, deduct, note } = req.body;
			if (!month) {
				return res.status(400).json({ error: 'กรุณาระบุเดือน' });
			}
			const salaryData = {
				income: income || {},
				deduct: deduct || {},
				note: note || "",
				saved_at: new Date().toISOString()
			};
			salaryData.summary = calculateSalarySummary(salaryData);
			await collection.updateOne(
				{ month },
				{ $set: { ...salaryData, month } },
				{ upsert: true }
			);
			return res.status(201).json({ success: true });
		} else if (req.method === 'DELETE') {
			const { month } = req.query;
			if (!month) {
				return res.status(400).json({ error: 'กรุณาระบุเดือนที่ต้องการลบ' });
			}
			const result = await collection.deleteOne({ month });
			if (result.deletedCount > 0) {
				return res.json({ success: true, message: 'ลบข้อมูลเงินเดือนเรียบร้อย' });
			} else {
				return res.status(404).json({ error: 'ไม่พบข้อมูลเดือนที่ระบุ' });
			}
		} else {
			res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
			return res.status(405).json({ error: 'Method not allowed' });
		}
	} catch (error) {
		console.error('Salary API Error:', error);
		return res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ', details: error.message });
	}
}