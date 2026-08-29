import { calculateSalarySummary } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import {
	isJsonMode,
	withGeneratedId,
	getMongoCollection
} from '../../lib/dataSource';
import {
	enforceSharedMonthWindowJson,
	enforceSharedMonthWindowMongo
} from '../../src/shared/utils/backend/sharedMonthWindow.js';
import {
	getUserData,
	updateUserData,
} from '../../src/backend/data/userUtils.js';

const COLLECTION_NAME = 'salary';
const JSON_FILENAME = 'salary.json';

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

// เช็คว่า doc เงินเดือนนี้มีข้อมูลจริง (income/deduct มีค่ามากกว่า 0 อย่างน้อย 1 รายการ)
// ใช้แยกแยะ "record ที่มีอยู่จริงแต่ว่างเปล่า" (เช่นจากปุ่มเพิ่มเดือนใหม่) ออกจาก
// "record ที่มีข้อมูลเงินเดือนจริง" — เพื่อไม่ให้ record ว่างมาบัง carry-forward ย้อนหลัง
function hasMeaningfulSalaryData(doc) {
	if (!doc || typeof doc !== 'object') return false;
	const income = doc.income || {};
	const deduct = doc.deduct || {};
	const hasIncome = Object.values(income).some((value) => Number(value) > 0);
	const hasDeduct = Object.values(deduct).some((value) => Number(value) > 0);
	return hasIncome || hasDeduct;
}

function findPrevMonthDoc(bucket, month) {
	const prevMonths = Object.keys(bucket)
		.filter((m) => m < month)
		.sort()
		.reverse();
	// เดินย้อนกลับจนเจอเดือนที่มีข้อมูลจริง ข้ามเดือนว่าง (blank record) ไป
	const found = prevMonths.find((m) => hasMeaningfulSalaryData(bucket[m]));
	return found ? bucket[found] : null;
}

function handleJsonSalaryGet(req, res, userId) {
	const bucket = getUserData(JSON_FILENAME, userId);
	const { month } = req.query;
	if (month) {
		let doc = bucket[month];
		if (!doc) {
			const prevDoc = findPrevMonthDoc(bucket, month);
			doc = withGeneratedId({
				...createDefaultSalaryStructure(),
				...(prevDoc ? { income: prevDoc.income || {}, deduct: prevDoc.deduct || {} } : {}),
				month,
			});
			// ไม่บันทึก carry-over ลงไฟล์ — แค่คืนข้อมูลเพื่อแสดงผล
			// บันทึกจริงเมื่อ user กด save (POST) เท่านั้น
		}
		const summary = doc.summary || calculateSalarySummary(doc);
		return res.json({ ...doc, summary });
	}
	const allData = {};
	Object.entries(bucket).forEach(([monthKey, doc]) => {
		if (!doc || !doc.month) return;
		const summary = doc.summary || calculateSalarySummary(doc);
		allData[monthKey] = { ...doc, summary };
	});
	return res.json(allData);
}

function handleJsonSalaryPost(req, res, userId) {
	const { month, income, deduct, note } = req.body;
	if (!month) {
		return res.status(400).json({ error: 'กรุณาระบุเดือน' });
	}
	const salaryData = {
		income: income || {},
		deduct: deduct || {},
		note: note || '',
		saved_at: new Date().toISOString()
	};
	salaryData.summary = calculateSalarySummary(salaryData);
	updateUserData(JSON_FILENAME, userId, (bucket) => {
		const nextBucket = { ...bucket };
		const existing = nextBucket[month] || {};
		nextBucket[month] = withGeneratedId({ ...existing, ...salaryData, month });
		return nextBucket;
	});
	// จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment) หลังเขียนไฟล์นี้แล้ว
	enforceSharedMonthWindowJson(userId, { extraMonth: month });
	return res.status(201).json({ success: true });
}

function handleJsonSalaryDelete(req, res, userId) {
	const { month } = req.query;
	if (!month) {
		return res.status(400).json({ error: 'กรุณาระบุเดือนที่ต้องการลบ' });
	}
	const bucket = getUserData(JSON_FILENAME, userId);
	if (!bucket[month]) {
		return res.status(404).json({ error: 'ไม่พบข้อมูลเดือนที่ระบุ' });
	}
	updateUserData(JSON_FILENAME, userId, (existing) => {
		const nextBucket = { ...existing };
		delete nextBucket[month];
		return nextBucket;
	});
	return res.json({ success: true, message: 'ลบข้อมูลเงินเดือนเรียบร้อย' });
}

export default async function handler(req, res) {
	const userId = assertUserId(req, res);
	if (!userId) return;

	if (isJsonMode()) {
		if (req.method === 'GET') {
			return handleJsonSalaryGet(req, res, userId);
		}
		if (req.method === 'POST') {
			return handleJsonSalaryPost(req, res, userId);
		}
		if (req.method === 'DELETE') {
			return handleJsonSalaryDelete(req, res, userId);
		}
		res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const collection = await getMongoCollection(COLLECTION_NAME);
	const userFilter = { userId };

	try {
		if (req.method === 'GET') {
			const { month } = req.query;
			if (month) {
				let doc = await collection.findOne({ month, ...userFilter });
				if (!doc) {
					const legacyDoc = await collection.findOne({ month, userId: { $exists: false } });
					if (legacyDoc) {
						const { _id, userId: legacyUser, ...rest } = legacyDoc;
						await collection.updateOne(
							{ month, ...userFilter },
							{ $set: { ...rest, month, ...userFilter } },
							{ upsert: true }
						);
						doc = { ...rest, month, ...userFilter };
					}
				}
				if (!doc) {
					// เดินย้อนกลับจนเจอเดือนที่มีข้อมูลจริง ข้ามเดือนว่าง (blank record) ไป
					// จำนวน doc ถูกจำกัดด้วยเพดาน 15 เดือนต่อ user (BR-002) จึงดึงมาทั้งหมดแล้วกรองใน JS ได้อย่างปลอดภัย
					const priorDocs = await collection
						.find({ ...userFilter, month: { $lt: month } })
						.sort({ month: -1 })
						.toArray();
					const prevDoc = priorDocs.find((d) => hasMeaningfulSalaryData(d)) || null;
					doc = { ...createDefaultSalaryStructure(), month };
					if (prevDoc) {
						doc.income = prevDoc.income || {};
						doc.deduct = prevDoc.deduct || {};
					}
					doc.summary = calculateSalarySummary(doc);
					// ไม่บันทึก carry-over ลง DB — แค่คืนข้อมูลเพื่อแสดงผล
					// บันทึกจริงเมื่อ user กด save (POST) เท่านั้น
				} else {
					// เติม default เฉพาะ field ที่ขาด (null/undefined) เท่านั้น
					// ไม่ overwrite ทั้ง doc — {} คือ "ไม่มีรายการ" ที่ถูกต้อง
					const defaults = createDefaultSalaryStructure();
					if (!doc.income) doc.income = defaults.income;
					if (!doc.deduct) doc.deduct = defaults.deduct;
				}
				// Ensure summary is present
				const sanitizedDoc = { ...doc };
				delete sanitizedDoc._id;
				delete sanitizedDoc.userId;
				let summary = doc && doc.summary ? doc.summary : calculateSalarySummary(doc);
				return res.json({
					...sanitizedDoc,
					summary
				});
			} else {
			// return all
			let allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
			if (!allDocs.length) {
				allDocs = await collection.find({ userId: { $exists: false }, month: { $exists: true } }).toArray();
			}
			const allData = {};
			allDocs.forEach(doc => {
				// Ensure summary is present
				let summary = doc && doc.summary ? doc.summary : calculateSalarySummary(doc);
				const sanitizedDoc = { ...doc };
				delete sanitizedDoc._id;
				delete sanitizedDoc.userId;
				allData[doc.month] = {
					...sanitizedDoc,
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
				{ month, ...userFilter },
				{ $set: { ...salaryData, month, ...userFilter } },
				{ upsert: true }
			);
			// จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment)
			await enforceSharedMonthWindowMongo(userId, { extraMonth: month });
			return res.status(201).json({ success: true });
		} else if (req.method === 'DELETE') {
			const { month } = req.query;
			if (!month) {
				return res.status(400).json({ error: 'กรุณาระบุเดือนที่ต้องการลบ' });
			}
			const result = await collection.deleteOne({ month, ...userFilter });
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