import { calculateSalarySummary, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import {
	isJsonMode,
	withGeneratedId,
	getMongoCollection
} from '../../lib/dataSource';

const {
	getUserData,
	updateUserData,
	limitUserEntries,
} = require('../../src/backend/data/userUtils');

const COLLECTION_NAME = 'salary';
const JSON_FILENAME = 'salary.json';
const MONTH_LIMIT = 15;

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

function enforceUserMonthLimit(bucket = {}) {
	return limitUserEntries(bucket, {
		limit: MONTH_LIMIT,
		keySelector: (_, value) => value?.month || ''
	});
}

function handleJsonSalaryGet(req, res, userId) {
	const bucket = getUserData(JSON_FILENAME, userId);
	const { month } = req.query;
	if (month) {
		let doc = bucket[month];
		if (!doc) {
			doc = withGeneratedId({ ...createDefaultSalaryStructure(), month });
			updateUserData(JSON_FILENAME, userId, (existing) => {
				const nextBucket = { ...existing };
				nextBucket[month] = doc;
				return enforceUserMonthLimit(nextBucket);
			});
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
		return enforceUserMonthLimit(nextBucket);
	});
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
					doc = createDefaultSalaryStructure();
					doc.month = month;
					await collection.insertOne({ ...doc, ...userFilter });
					await enforceMonthLimit(collection, 15, { filter: userFilter });
				} else {
					// fallback income/deduct เป็น default ถ้าไม่มี
					if (!doc.income || Object.keys(doc.income).length === 0 || !doc.deduct || Object.keys(doc.deduct).length === 0) {
						doc = createDefaultSalaryStructure();
						doc.month = month;
						await collection.updateOne({ month, ...userFilter }, { $set: { ...doc, ...userFilter } });
					}
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
			await enforceMonthLimit(collection, 15, { filter: userFilter });
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