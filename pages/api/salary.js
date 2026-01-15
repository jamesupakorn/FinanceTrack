import { calculateSalarySummary, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import {
	isJsonMode,
	readJsonCollection,
	writeJsonCollection,
	withGeneratedId,
	enforceJsonLimit,
	getMongoCollection
} from '../../lib/dataSource';

const COLLECTION_NAME = 'salary';

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

function enforceJsonMonthLimit(docs) {
	return enforceJsonLimit({
		docs,
		limit: 15,
		selector: (doc) => doc && doc.month
	});
}

async function handleJsonSalaryGet(req, res) {
	const docs = await readJsonCollection(COLLECTION_NAME);
	const { month } = req.query;
	if (month) {
		let doc = docs.find(item => item.month === month);
		let mutatedDocs = docs;
		if (!doc) {
			doc = withGeneratedId({ ...createDefaultSalaryStructure(), month });
			mutatedDocs = enforceJsonMonthLimit([...docs, doc]);
			await writeJsonCollection(COLLECTION_NAME, mutatedDocs);
		}
		const summary = doc.summary || calculateSalarySummary(doc);
		return res.json({ ...doc, summary });
	}
	const allData = {};
	docs.forEach(doc => {
		if (!doc || !doc.month) return;
		const summary = doc.summary || calculateSalarySummary(doc);
		allData[doc.month] = { ...doc, summary };
	});
	return res.json(allData);
}

async function handleJsonSalaryPost(req, res) {
	const { month, income, deduct, note } = req.body;
	if (!month) {
		return res.status(400).json({ error: 'กรุณาระบุเดือน' });
	}
	const docs = await readJsonCollection(COLLECTION_NAME);
	const idx = docs.findIndex(doc => doc.month === month);
	const salaryData = {
		income: income || {},
		deduct: deduct || {},
		note: note || '',
		saved_at: new Date().toISOString()
	};
	salaryData.summary = calculateSalarySummary(salaryData);
	if (idx >= 0) {
		docs[idx] = { ...docs[idx], ...salaryData, month };
	} else {
		docs.push(withGeneratedId({ ...salaryData, month }));
	}
	const limited = enforceJsonMonthLimit(docs);
	await writeJsonCollection(COLLECTION_NAME, limited);
	return res.status(201).json({ success: true });
}

async function handleJsonSalaryDelete(req, res) {
	const { month } = req.query;
	if (!month) {
		return res.status(400).json({ error: 'กรุณาระบุเดือนที่ต้องการลบ' });
	}
	const docs = await readJsonCollection(COLLECTION_NAME);
	const filtered = docs.filter(doc => doc.month !== month);
	if (filtered.length === docs.length) {
		return res.status(404).json({ error: 'ไม่พบข้อมูลเดือนที่ระบุ' });
	}
	await writeJsonCollection(COLLECTION_NAME, filtered);
	return res.json({ success: true, message: 'ลบข้อมูลเงินเดือนเรียบร้อย' });
}

export default async function handler(req, res) {
	if (isJsonMode()) {
		if (req.method === 'GET') {
			return handleJsonSalaryGet(req, res);
		}
		if (req.method === 'POST') {
			return handleJsonSalaryPost(req, res);
		}
		if (req.method === 'DELETE') {
			return handleJsonSalaryDelete(req, res);
		}
		res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const collection = await getMongoCollection(COLLECTION_NAME);

	try {
		if (req.method === 'GET') {
			const { month } = req.query;
			if (month) {
				let doc = await collection.findOne({ month });
				if (!doc) {
					doc = createDefaultSalaryStructure();
					doc.month = month;
					await collection.insertOne({ ...doc });
					await enforceMonthLimit(collection, 15);
				} else {
					// fallback income/deduct เป็น default ถ้าไม่มี
					if (!doc.income || Object.keys(doc.income).length === 0 || !doc.deduct || Object.keys(doc.deduct).length === 0) {
						doc = createDefaultSalaryStructure();
						doc.month = month;
						await collection.updateOne({ month }, { $set: { ...doc } });
					}
				}
				// Ensure summary is present
				let summary = doc && doc.summary ? doc.summary : calculateSalarySummary(doc);
				return res.json({
					...doc,
					summary
				});
			} else {
			// return all
			const allDocs = await collection.find({}).toArray();
			const allData = {};
			allDocs.forEach(doc => {
				// Ensure summary is present
				let summary = doc && doc.summary ? doc.summary : calculateSalarySummary(doc);
				allData[doc.month] = {
					...doc,
					summary
				};
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
			await enforceMonthLimit(collection, 15);
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