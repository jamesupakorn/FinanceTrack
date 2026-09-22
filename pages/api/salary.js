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
} from '../../src/shared/utils/backend/sharedMonthWindow';
import {
	getUserData,
	updateUserData,
} from '../../src/backend/data/userUtils.js';
import {
	normaliseOvertimeRows,
	extractLegacyOvertimeRows,
	stripLegacyOvertimeKeys
} from '../../src/shared/utils/overtimeUtils';

const COLLECTION_NAME = 'salary';
const JSON_FILENAME = 'salary.json';

function createDefaultSalaryStructure() {
	return {
		income: {
			// คีย์ overtime_* แบบยอดคงที่ถูกถอดออกจาก default แล้ว — OT คำนวณจาก overtime[] แทน
			// เอกสารเก่าที่มีคีย์เหล่านี้อยู่ยังเก็บไว้ตลอดไป ไม่มี migration (DATA_MODEL)
			salary: 0,
			bonus: 0,
			other_income: 0
		},
		deduct: {
			provident_fund: 0,
			social_security: 0,
			tax: 0
		},
		overtime: [],
		summary: {
			total_income: 0,
			total_deduct: 0,
			net_income: 0
		},
		saved_at: new Date().toISOString(),
		note: ""
	};
}

/**
 * ตัวแปลงตอน GET ที่ใช้ร่วมกันทุกเส้นทาง (JSON/Mongo × ระบุเดือน/ไม่ระบุเดือน) — A-2
 * 1. normalise overtime ให้เป็น OvertimeRow[] เสมอ (เอกสารเก่าไม่มีฟิลด์นี้ หรือมีสมาชิกเพี้ยน)
 * 2. derive overtimeLegacy จาก income — เป็นการแปลงตอนแสดงผลล้วน ๆ **ไม่แตะ income** (D-1)
 * summary ของเอกสารที่บันทึกแล้วคืนตามที่เก็บไว้ ส่วน carry-forward คำนวณใหม่ที่ call site
 */
function decorateSalaryDocForGet(doc) {
	const income = doc.income || {};
	return {
		...doc,
		overtime: normaliseOvertimeRows(doc.overtime),
		overtimeLegacy: extractLegacyOvertimeRows(income)
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
				// เงินเดือนเกิดซ้ำทุกเดือน แต่ OT ไม่ — ยอด OT แบบเดิมถูกตัดออกจาก income ที่คัดลอกมา
				// และ overtime[] ไม่ถูก carry-forward (คงเป็น [] ตาม default) — V-3 / BR-OT-007/008
				...(prevDoc ? { income: stripLegacyOvertimeKeys(prevDoc.income || {}), deduct: prevDoc.deduct || {} } : {}),
				month,
			});
			// summary ของ default structure เป็น object ที่ truthy อยู่แล้ว `||` ด้านล่างจึงไม่ทำงาน
			// ทำให้เดือน carry-forward เคยคืน summary เป็นศูนย์ทั้งชุด — คำนวณใหม่ตรงนี้ให้ตรงกับฝั่ง
			// Mongo (A-5 / AC-OT-26) และต้องทำ *หลัง* ตัดคีย์ OT เดิมออกแล้วเท่านั้น (A-1)
			doc.summary = calculateSalarySummary({ ...doc, month });
			// ไม่บันทึก carry-over ลงไฟล์ — แค่คืนข้อมูลเพื่อแสดงผล
			// บันทึกจริงเมื่อ user กด save (POST) เท่านั้น
		}
		const summary = doc.summary || calculateSalarySummary({ ...doc, month });
		return res.json(decorateSalaryDocForGet({ ...doc, summary }));
	}
	const allData = {};
	Object.entries(bucket).forEach(([monthKey, doc]) => {
		if (!doc || !doc.month) return;
		const summary = doc.summary || calculateSalarySummary({ ...doc, month: doc.month });
		allData[monthKey] = decorateSalaryDocForGet({ ...doc, summary });
	});
	return res.json(allData);
}

function handleJsonSalaryPost(req, res, userId) {
	const { month, income, deduct, note, overtime } = req.body;
	if (!month) {
		return res.status(400).json({ error: 'กรุณาระบุเดือน' });
	}
	const salaryData = {
		income: income || {},
		deduct: deduct || {},
		// เขียนทุกครั้งแม้เป็น [] — การเขียนเป็นแบบ merge ระดับบนสุด ถ้าไม่ส่งจะเหลือแถวเดิมค้างไว้
		// (DATA_MODEL inv. 3) และ normalise ทิ้ง property อื่น เช่น amount ที่ client ส่งมา (inv. 4)
		overtime: normaliseOvertimeRows(overtime),
		note: note || '',
		saved_at: new Date().toISOString()
	};
	// ต้องส่ง month เข้าไปด้วย ไม่งั้น OT จะคิดเป็น 0 ใน summary ที่บันทึกจริง ขณะที่ UI แสดงเลขถูก (V-1)
	salaryData.summary = calculateSalarySummary({ ...salaryData, month });
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
					// เดินย้อนกลับจนเจอเดือนที่มีข้อมูลจริง ข้ามเดือนว่าง (blank record) ไป
					// จำนวน doc ถูกจำกัดด้วยเพดาน 15 เดือนต่อ user (BR-002) จึงดึงมาทั้งหมดแล้วกรองใน JS ได้อย่างปลอดภัย
					const priorDocs = await collection
						.find({ ...userFilter, month: { $lt: month } })
						.sort({ month: -1 })
						.toArray();
					const prevDoc = priorDocs.find((d) => hasMeaningfulSalaryData(d)) || null;
					doc = { ...createDefaultSalaryStructure(), month };
					if (prevDoc) {
						// ตัดคีย์ OT เดิมออก *ก่อน* คำนวณ summary ไม่งั้นยอดที่ตัดทิ้งจะถูกนับต่อ (V-3 / A-1)
						// และไม่ carry-forward overtime[] — คงเป็น [] ตาม default (BR-OT-007/008)
						doc.income = stripLegacyOvertimeKeys(prevDoc.income || {});
						doc.deduct = prevDoc.deduct || {};
					}
					doc.summary = calculateSalarySummary({ ...doc, month });
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
				let summary = doc && doc.summary ? doc.summary : calculateSalarySummary({ ...doc, month });
				return res.json(decorateSalaryDocForGet({
					...sanitizedDoc,
					summary
				}));
			} else {
			// return all
			const allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
			const allData = {};
			allDocs.forEach(doc => {
				// Ensure summary is present
				let summary = doc && doc.summary ? doc.summary : calculateSalarySummary({ ...doc, month: doc.month });
				const sanitizedDoc = { ...doc };
				delete sanitizedDoc._id;
				delete sanitizedDoc.userId;
				allData[doc.month] = decorateSalaryDocForGet({
					...sanitizedDoc,
					summary
				});
			});
			return res.json(allData);
			}
		} else if (req.method === 'POST') {
			const { month, income, deduct, note, overtime } = req.body;
			if (!month) {
				return res.status(400).json({ error: 'กรุณาระบุเดือน' });
			}
			const salaryData = {
				income: income || {},
				deduct: deduct || {},
				// $set แบบ merge ระดับบนสุด — ต้องเขียน overtime ทุกครั้งแม้เป็น [] (DATA_MODEL inv. 3)
				overtime: normaliseOvertimeRows(overtime),
				note: note || "",
				saved_at: new Date().toISOString()
			};
			// V-1: month ต้องถึง calculateSalarySummary ไม่งั้น total_income ที่เก็บจะขาด OT ไปเงียบ ๆ
			salaryData.summary = calculateSalarySummary({ ...salaryData, month });
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