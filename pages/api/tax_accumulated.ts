import type { NextApiRequest, NextApiResponse } from 'next';
import type { Collection, Document } from 'mongodb';
import { ensureMonthlyProvident } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import {
	isJsonMode,
	withGeneratedId,
	getMongoCollection
} from '../../lib/dataSource';
import {
	getUserData,
	updateUserData,
} from '../../src/backend/data/userUtils';
import { withAudit } from '../../lib/auditedMutation';

const COLLECTION_NAME = 'tax_accumulated';
const JSON_FILENAME = 'tax_accumulated.json';

type TaxYearDoc = {
	year?: string;
	accumulated_tax?: number | string;
	monthly_tax?: Record<string, string>;
	monthly_income?: Record<string, string>;
	monthly_provident?: Record<string, string>;
	_id?: unknown;
	userId?: unknown;
	[key: string]: unknown;
};
type TaxBucket = Record<string, TaxYearDoc>;
type TaxYearMutator = (doc: TaxYearDoc) => void;

function buildDefaultYearDoc(year: string): TaxYearDoc {
	return {
		year,
		accumulated_tax: 0,
		monthly_tax: {},
		monthly_income: {},
		monthly_provident: {}
	};
}

function handleJsonTaxGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
	const bucket = getUserData(JSON_FILENAME, userId) as TaxBucket;
	const year = Array.isArray(req.query.year) ? req.query.year[0] : req.query.year;
	if (year) {
		const doc = bucket[year];
		const response = ensureMonthlyProvident(doc ? { ...doc } : buildDefaultYearDoc(year));
		return res.status(200).json({ [year]: response });
	}
	const data: { tax_by_year: Record<string, TaxYearDoc> } = { tax_by_year: {} };
	Object.entries(bucket).forEach(([yearKey, doc]: [string, TaxYearDoc]) => {
		if (!doc || !doc.year) return;
		data.tax_by_year[yearKey] = ensureMonthlyProvident({ ...doc });
	});
	return res.status(200).json(data);
}

function handleJsonTaxPost(req: NextApiRequest, res: NextApiResponse, userId: string) {
	const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
	const { year, accumulated_tax, monthly_tax, monthly_income, monthly_provident } = body;
	if (typeof year !== 'string' || !year) {
		return res.status(400).json({ error: 'year required' });
	}
	const update: TaxYearDoc = { year };
	if (accumulated_tax !== undefined) update.accumulated_tax = accumulated_tax as number | string;
	if (monthly_tax !== undefined && typeof monthly_tax === 'object' && monthly_tax !== null) update.monthly_tax = monthly_tax as Record<string, string>;
	if (monthly_income !== undefined && typeof monthly_income === 'object' && monthly_income !== null) update.monthly_income = monthly_income as Record<string, string>;
	if (monthly_provident !== undefined && typeof monthly_provident === 'object' && monthly_provident !== null) update.monthly_provident = monthly_provident as Record<string, string>;
	updateUserData(JSON_FILENAME, userId, (bucket: TaxBucket) => {
		const nextBucket: TaxBucket = { ...bucket };
		const baseDoc = nextBucket[year] || buildDefaultYearDoc(year);
		const merged = { ...baseDoc, ...update };
		nextBucket[year] = baseDoc._id ? { ...merged, _id: baseDoc._id } : withGeneratedId(merged);
		return nextBucket;
	});
	return res.status(201).json({ success: true });
}

function handleJsonTaxDelete(req: NextApiRequest, res: NextApiResponse, userId: string) {
	const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
	const year = body.year;
	if (typeof year !== 'string' || !year) {
		return res.status(400).json({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
	}
	const bucket = getUserData(JSON_FILENAME, userId) as TaxBucket;
	if (!bucket[year]) {
		return res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
	}
	updateUserData(JSON_FILENAME, userId, (existing: TaxBucket) => {
		const nextBucket: TaxBucket = { ...existing };
		delete nextBucket[year];
		return nextBucket;
	});
	return res.status(200).json({ success: true, message: `ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว` });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	const userId = assertUserId(req, res);
	if (!userId) return;
	if (!validateApiRequest(req, res, 'tax_accumulated')) return;

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

	const collection: Collection<Document> = await getMongoCollection(COLLECTION_NAME);
	const userFilter = { userId };

	if (req.method === 'GET') {
		const year = Array.isArray(req.query.year) ? req.query.year[0] : req.query.year;
		if (year) {
			const doc = await collection.findOne({ year, ...userFilter });
			if (!doc) {
				return res.status(200).json({ [year]: { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} } });
			}
			const sanitized = ensureMonthlyProvident({ ...doc });
			delete sanitized._id;
			delete sanitized.userId;
			return res.status(200).json({ [year]: sanitized });
		}
		const allDocs = await collection.find({ ...userFilter }).toArray();
		const data: { tax_by_year: Record<string, TaxYearDoc> } = { tax_by_year: {} };
		allDocs.forEach(doc => {
			const sanitized = ensureMonthlyProvident({ ...doc });
			delete sanitized._id;
			delete sanitized.userId;
			data.tax_by_year[doc.year] = sanitized;
		});
		return res.status(200).json(data);
	} else if (req.method === 'POST') {
		const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
		const { year, accumulated_tax, monthly_tax, monthly_income, monthly_provident } = body;
		if (typeof year !== 'string' || !year) {
			return res.status(400).json({ error: 'year required' });
		}
		const update: TaxYearDoc = {};
		if (accumulated_tax !== undefined) update.accumulated_tax = accumulated_tax as number | string;
		if (monthly_tax !== undefined && typeof monthly_tax === 'object' && monthly_tax !== null) update.monthly_tax = monthly_tax as Record<string, string>;
		if (monthly_income !== undefined && typeof monthly_income === 'object' && monthly_income !== null) update.monthly_income = monthly_income as Record<string, string>;
		if (monthly_provident !== undefined && typeof monthly_provident === 'object' && monthly_provident !== null) update.monthly_provident = monthly_provident as Record<string, string>;
		await collection.updateOne(
			{ year, ...userFilter },
			{ $set: { year, ...update, ...userFilter } },
			{ upsert: true }
		);
		return res.status(201).json({ success: true });
	} else if (req.method === 'DELETE') {
		const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
		const year = body.year;
		if (typeof year !== 'string' || !year) {
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
async function mutateTaxYear(userId: string, year: string, mutator: TaxYearMutator): Promise<void> {
	if (!year) return;
	if (isJsonMode()) {
		updateUserData(JSON_FILENAME, userId, (bucket: TaxBucket) => {
			const nextBucket: TaxBucket = { ...bucket };
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
	let data = await collection.findOne(filter) as TaxYearDoc | null;
	if (!data) {
		data = buildDefaultYearDoc(year);
	}
	mutator(data);
	const payload = { ...data };
	delete payload._id;
	await collection.updateOne(
		filter,
		{ $set: { year, ...payload, ...userFilter } },
		{ upsert: true }
	);
}

export async function updateMonthlyTax(userId: string, year: string, month: string, value: string | number) {
	// อัปเดตยอดภาษีรายเดือนในปีที่ระบุ
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
export async function updateMonthlyIncome(userId: string, year: string, month: string, value: string | number) {
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
export async function updateMonthlyProvident(userId: string, year: string, month: string, value: string | number) {
	await mutateTaxYear(userId, year, (doc) => {
		if (!doc.monthly_provident) doc.monthly_provident = {};
		doc.monthly_provident[month] = value.toString();
	});
}

export default withAudit(handler, { source: 'tax_accumulated' });
