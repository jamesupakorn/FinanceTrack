import dbPromise from '../../lib/mongodb';

export default async function handler(req, res) {
	const db = await dbPromise;
	const collection = db.collection('tax_accumulated');

	if (req.method === 'GET') {
		const { year } = req.query;
		if (year) {
			const doc = await collection.findOne({ year });
			if (!doc) {
				return res.status(200).json({ [year]: { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} } });
			}
			// Ensure monthly_provident is always present for frontend
			if (!doc.monthly_provident) doc.monthly_provident = {};
			return res.status(200).json({ [year]: doc });
		} else {
			// all years
			const allDocs = await collection.find({}).toArray();
			const data = { tax_by_year: {} };
			allDocs.forEach(doc => {
				if (!doc.monthly_provident) doc.monthly_provident = {};
				data.tax_by_year[doc.year] = doc;
			});
			return res.status(200).json(data);
		}
	} else if (req.method === 'POST') {
		const { year, accumulated_tax, monthly_tax, monthly_income, monthly_provident } = req.body;
		if (!year) {
			return res.status(400).json({ error: 'year required' });
		}
		// build update object
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
		} else {
			return res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
		}
	} else {
		res.status(405).end();
	}
}
/**
 * อัพเดตข้อมูลภาษีรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดภาษีใหม่
 */
export async function updateMonthlyTax(year, month, value) {
	const db = await dbPromise;
	const collection = db.collection('tax_accumulated');

	const data = await collection.findOne({ year });
	if (!data) {
		return;
	}
	if (!data.tax_by_year) data.tax_by_year = {};
	if (!data.tax_by_year[year]) {
		data.tax_by_year[year] = { accumulated_tax: 0, monthly_tax: {} };
	}
	if (!data.tax_by_year[year].monthly_tax) {
		data.tax_by_year[year].monthly_tax = {};
	}
	data.tax_by_year[year].monthly_tax[month] = value.toString();
	await collection.updateOne(
		{ year },
		{ $set: { year, tax_by_year: data.tax_by_year } },
		{ upsert: true }
	);
}

/**
 * อัพเดตข้อมูลรายรับรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดรายรับใหม่
 */
export async function updateMonthlyIncome(year, month, value) {
	const db = await dbPromise;
	const collection = db.collection('tax_accumulated');

	const data = await collection.findOne({ year });
	if (!data) {
		return;
	}
	if (!data.tax_by_year) data.tax_by_year = {};
	if (!data.tax_by_year[year]) {
		data.tax_by_year[year] = { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} };
	}
	if (!data.tax_by_year[year].monthly_income) {
		data.tax_by_year[year].monthly_income = {};
	}
	data.tax_by_year[year].monthly_income[month] = value.toString();
	await collection.updateOne(
		{ year },
		{ $set: { year, tax_by_year: data.tax_by_year } },
		{ upsert: true }
	);
}

/**
 * อัพเดตข้อมูลกองทุนสำรองเลี้ยงชีพรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดกองทุนใหม่
 */
export async function updateMonthlyProvident(year, month, value) {
	const db = await dbPromise;
	const collection = db.collection('tax_accumulated');

	const data = await collection.findOne({ year });
	if (!data) {
		return;
	}
	if (!data.tax_by_year) data.tax_by_year = {};
	if (!data.tax_by_year[year]) {
		data.tax_by_year[year] = { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} };
	}
	if (!data.tax_by_year[year].monthly_provident) {
		data.tax_by_year[year].monthly_provident = {};
	}
	data.tax_by_year[year].monthly_provident[month] = value.toString();
	await collection.updateOne(
		{ year },
		{ $set: { year, tax_by_year: data.tax_by_year } },
		{ upsert: true }
	);
}