import { ensureMonthlyProvident } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import {
	isJsonMode,
	withGeneratedId,
	getMongoCollection
} from '../../lib/dataSource';

const {
	getUserData,
	updateUserData,
} = require('../../src/backend/data/userUtils');

const COLLECTION_NAME = 'tax_accumulated';
const JSON_FILENAME = 'tax_accumulated.json';

function buildDefaultYearDoc(year) {
	return {
		year,
		accumulated_tax: 0,
		monthly_tax: {},
		monthly_income: {},
		monthly_provident: {}
	};
}

function handleJsonTaxGet(req, res, userId) {
	const bucket = getUserData(JSON_FILENAME, userId);
	const { year } = req.query;
	if (year) {
		const doc = bucket[year];
		const response = ensureMonthlyProvident(doc ? { ...doc } : buildDefaultYearDoc(year));
		return res.status(200).json({ [year]: response });
	}
	const data = { tax_by_year: {} };
	Object.entries(bucket).forEach(([yearKey, doc]) => {
		if (!doc || !doc.year) return;
		data.tax_by_year[yearKey] = ensureMonthlyProvident({ ...doc });
	});
	return res.status(200).json(data);
}

function handleJsonTaxPost(req, res, userId) {
	const { year, accumulated_tax, monthly_tax, monthly_income, monthly_provident } = req.body;
	if (!year) {
		return res.status(400).json({ error: 'year required' });
	}
	const update = { year };
	if (accumulated_tax !== undefined) update.accumulated_tax = accumulated_tax;
	if (monthly_tax !== undefined) update.monthly_tax = monthly_tax;
	if (monthly_income !== undefined) update.monthly_income = monthly_income;
	if (monthly_provident !== undefined) update.monthly_provident = monthly_provident;
	updateUserData(JSON_FILENAME, userId, (bucket) => {
		const nextBucket = { ...bucket };
		const baseDoc = nextBucket[year] || buildDefaultYearDoc(year);
		const merged = { ...baseDoc, ...update };
		nextBucket[year] = baseDoc._id ? { ...merged, _id: baseDoc._id } : withGeneratedId(merged);
		return nextBucket;
	});
	return res.status(201).json({ success: true });
}

function handleJsonTaxDelete(req, res, userId) {
	const { year } = req.body;
	if (!year) {
		return res.status(400).json({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
	}
	const bucket = getUserData(JSON_FILENAME, userId);
	if (!bucket[year]) {
		return res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
	}
	updateUserData(JSON_FILENAME, userId, (existing) => {
		const nextBucket = { ...existing };
		delete nextBucket[year];
		return nextBucket;
	});
	return res.status(200).json({ success: true, message: `ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว` });
}

export default async function handler(req, res) {
	const userId = assertUserId(req, res);
	if (!userId) return;

	if (isJsonMode()) {
		if (req.method === 'GET') {
			return handleJsonTaxGet(req, res, userId);
		}
		if (req.method === 'POST') {
			return handleJsonTaxPost(req, res, userId);
		}
		if (req.method === 'DELETE') {
			return handleJsonTaxDelete(req, res, userId);
		}
		return res.status(405).end();
	}

	const collection = await getMongoCollection(COLLECTION_NAME);
	const userFilter = { userId };

	if (req.method === 'GET') {
		const { year } = req.query;
		if (year) {
			let doc = await collection.findOne({ year, ...userFilter });
			if (!doc) {
				const legacyDoc = await collection.findOne({ year, userId: { $exists: false } });
				if (legacyDoc) {
					const { _id, userId: legacyUser, ...rest } = legacyDoc;
					await collection.updateOne(
						{ year, ...userFilter },
						{ $set: { ...rest, year, ...userFilter } },
						{ upsert: true }
					);
					doc = { ...rest, year, ...userFilter };
				}
			}
			if (!doc) {
				return res.status(200).json({ [year]: { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} } });
			}
			const sanitized = ensureMonthlyProvident({ ...doc });
			delete sanitized._id;
			delete sanitized.userId;
			return res.status(200).json({ [year]: sanitized });
		}
		let allDocs = await collection.find({ ...userFilter }).toArray();
		if (!allDocs.length) {
			allDocs = await collection.find({ userId: { $exists: false } }).toArray();
		}
		const data = { tax_by_year: {} };
		allDocs.forEach(doc => {
			const sanitized = ensureMonthlyProvident({ ...doc });
			delete sanitized._id;
			delete sanitized.userId;
			data.tax_by_year[doc.year] = sanitized;
		});
		return res.status(200).json(data);
	} else if (req.method === 'POST') {
		const { year, accumulated_tax, monthly_tax, monthly_income, monthly_provident } = req.body;
		if (!year) {
			return res.status(400).json({ error: 'year required' });
		}
		const update = {};
		if (accumulated_tax !== undefined) update.accumulated_tax = accumulated_tax;
		if (monthly_tax !== undefined) update.monthly_tax = monthly_tax;
		if (monthly_income !== undefined) update.monthly_income = monthly_income;
		if (monthly_provident !== undefined) update.monthly_provident = monthly_provident;
		await collection.updateOne(
			{ year, ...userFilter },
			{ $set: { year, ...update, ...userFilter } },
			{ upsert: true }
		);
		return res.status(201).json({ success: true });
	} else if (req.method === 'DELETE') {
		const { year } = req.body;
		if (!year) {
			return res.status(400).json({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
		}
		const result = await collection.deleteOne({ year, ...userFilter });
		if (result.deletedCount > 0) {
			return res.status(200).json({ success: true, message: `ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว` });
		}
		return res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
	}
	res.status(405).end();
}
/**
 * อัพเดตข้อมูลภาษีรายเดือนในปีและเดือนที่ระบุ
 * @param {string} userId - รหัสผู้ใช้
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดภาษีใหม่
 */
async function mutateTaxYear(userId, year, mutator) {
	if (!year || typeof mutator !== 'function') return;
	if (isJsonMode()) {
		updateUserData(JSON_FILENAME, userId, (bucket) => {
			const nextBucket = { ...bucket };
			const baseDoc = nextBucket[year] || withGeneratedId(buildDefaultYearDoc(year));
			const clone = { ...baseDoc };
			mutator(clone);
			nextBucket[year] = clone;
			return nextBucket;
		});
		return;
	}
	const collection = await getMongoCollection(COLLECTION_NAME);
	const userFilter = { userId };
	const filter = { year, ...userFilter };
	let data = await collection.findOne(filter);
	if (!data) {
		const legacyDoc = await collection.findOne({ year, userId: { $exists: false } });
		if (legacyDoc) {
			const { _id, userId: legacyUser, ...rest } = legacyDoc;
			data = { ...rest, year, ...userFilter };
		} else {
			data = buildDefaultYearDoc(year);
		}
	}
	mutator(data);
	const { _id, ...payload } = data;
	await collection.updateOne(
		filter,
		{ $set: { year, ...payload, ...userFilter } },
		{ upsert: true }
	);
}

export async function updateMonthlyTax(userId, year, month, value) {
	await mutateTaxYear(userId, year, (doc) => {
		if (!doc.monthly_tax) doc.monthly_tax = {};
		doc.monthly_tax[month] = value.toString();
	});
}

/**
 * อัพเดตรายรับรายเดือนในปีและเดือนที่ระบุ
 * @param {string} userId - รหัสผู้ใช้
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดรายรับใหม่
 */
export async function updateMonthlyIncome(userId, year, month, value) {
	await mutateTaxYear(userId, year, (doc) => {
		if (!doc.monthly_income) doc.monthly_income = {};
		doc.monthly_income[month] = value.toString();
	});
}

/**
 * อัพเดตกองทุนสำรองเลี้ยงชีพรายเดือนในปีและเดือนที่ระบุ
 * @param {string} userId - รหัสผู้ใช้
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดกองทุนใหม่
 */
export async function updateMonthlyProvident(userId, year, month, value) {
	await mutateTaxYear(userId, year, (doc) => {
		if (!doc.monthly_provident) doc.monthly_provident = {};
		doc.monthly_provident[month] = value.toString();
	});
}