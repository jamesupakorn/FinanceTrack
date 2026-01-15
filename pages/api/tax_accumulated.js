import { ensureMonthlyProvident } from '../../src/shared/utils/backend/apiUtils';
import {
	isJsonMode,
	readJsonCollection,
	writeJsonCollection,
	withGeneratedId,
	getMongoCollection
} from '../../lib/dataSource';

const COLLECTION_NAME = 'tax_accumulated';

function buildDefaultYearDoc(year) {
	return {
		year,
		accumulated_tax: 0,
		monthly_tax: {},
		monthly_income: {},
		monthly_provident: {}
	};
}

async function handleJsonTaxGet(req, res) {
	const docs = await readJsonCollection(COLLECTION_NAME);
	const { year } = req.query;
	if (year) {
		const doc = docs.find(d => d.year === year);
		const response = ensureMonthlyProvident(doc ? { ...doc } : buildDefaultYearDoc(year));
		return res.status(200).json({ [year]: response });
	}
	const data = { tax_by_year: {} };
	docs.forEach(doc => {
		if (!doc || !doc.year) return;
		data.tax_by_year[doc.year] = ensureMonthlyProvident({ ...doc });
	});
	return res.status(200).json(data);
}

async function handleJsonTaxPost(req, res) {
	const { year, accumulated_tax, monthly_tax, monthly_income, monthly_provident } = req.body;
	if (!year) {
		return res.status(400).json({ error: 'year required' });
	}
	const docs = await readJsonCollection(COLLECTION_NAME);
	const idx = docs.findIndex(doc => doc.year === year);
	const update = { year };
	if (accumulated_tax !== undefined) update.accumulated_tax = accumulated_tax;
	if (monthly_tax !== undefined) update.monthly_tax = monthly_tax;
	if (monthly_income !== undefined) update.monthly_income = monthly_income;
	if (monthly_provident !== undefined) update.monthly_provident = monthly_provident;
	if (idx >= 0) {
		docs[idx] = { ...docs[idx], ...update };
	} else {
		docs.push(withGeneratedId({ ...buildDefaultYearDoc(year), ...update }));
	}
	await writeJsonCollection(COLLECTION_NAME, docs);
	return res.status(201).json({ success: true });
}

async function handleJsonTaxDelete(req, res) {
	const { year } = req.body;
	if (!year) {
		return res.status(400).json({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
	}
	const docs = await readJsonCollection(COLLECTION_NAME);
	const filtered = docs.filter(doc => doc.year !== year);
	if (filtered.length === docs.length) {
		return res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
	}
	await writeJsonCollection(COLLECTION_NAME, filtered);
	return res.status(200).json({ success: true, message: `ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว` });
}

export default async function handler(req, res) {
	if (isJsonMode()) {
		if (req.method === 'GET') {
			return handleJsonTaxGet(req, res);
		}
		if (req.method === 'POST') {
			return handleJsonTaxPost(req, res);
		}
		if (req.method === 'DELETE') {
			return handleJsonTaxDelete(req, res);
		}
		return res.status(405).end();
	}

	const collection = await getMongoCollection(COLLECTION_NAME);

	if (req.method === 'GET') {
		const { year } = req.query;
		if (year) {
			const doc = await collection.findOne({ year });
			if (!doc) {
				return res.status(200).json({ [year]: { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} } });
			}
			return res.status(200).json({ [year]: ensureMonthlyProvident(doc) });
		}
		const allDocs = await collection.find({}).toArray();
		const data = { tax_by_year: {} };
		allDocs.forEach(doc => {
			data.tax_by_year[doc.year] = ensureMonthlyProvident(doc);
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
			{ year },
			{ $set: { year, ...update } },
			{ upsert: true }
		);
		return res.status(201).json({ success: true });
	} else if (req.method === 'DELETE') {
		const { year } = req.body;
		if (!year) {
			return res.status(400).json({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
		}
		const result = await collection.deleteOne({ year });
		if (result.deletedCount > 0) {
			return res.status(200).json({ success: true, message: `ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว` });
		}
		return res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
	}
	res.status(405).end();
}
/**
 * อัพเดตข้อมูลภาษีรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดภาษีใหม่
 */
async function mutateTaxYear(year, mutator) {
	if (!year || typeof mutator !== 'function') return;
	if (isJsonMode()) {
		const docs = await readJsonCollection(COLLECTION_NAME);
		const idx = docs.findIndex(doc => doc.year === year);
		let doc;
		if (idx === -1) {
			doc = withGeneratedId(buildDefaultYearDoc(year));
			docs.push(doc);
		} else {
			doc = docs[idx];
		}
		mutator(doc);
		await writeJsonCollection(COLLECTION_NAME, docs);
		return;
	}
	const collection = await getMongoCollection(COLLECTION_NAME);
	const data = (await collection.findOne({ year })) || buildDefaultYearDoc(year);
	mutator(data);
	const { _id, ...payload } = data;
	await collection.updateOne(
		{ year },
		{ $set: { year, ...payload } },
		{ upsert: true }
	);
}

export async function updateMonthlyTax(year, month, value) {
	await mutateTaxYear(year, (doc) => {
		if (!doc.monthly_tax) doc.monthly_tax = {};
		doc.monthly_tax[month] = value.toString();
	});
}

/**
 * อัพเดตข้อมูลรายรับรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดรายรับใหม่
 */
export async function updateMonthlyIncome(year, month, value) {
	await mutateTaxYear(year, (doc) => {
		if (!doc.monthly_income) doc.monthly_income = {};
		doc.monthly_income[month] = value.toString();
	});
}

/**
 * อัพเดตข้อมูลกองทุนสำรองเลี้ยงชีพรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดกองทุนใหม่
 */
export async function updateMonthlyProvident(year, month, value) {
	await mutateTaxYear(year, (doc) => {
		if (!doc.monthly_provident) doc.monthly_provident = {};
		doc.monthly_provident[month] = value.toString();
	});
}