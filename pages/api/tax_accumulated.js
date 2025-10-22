/**
 * อัพเดตข้อมูลรายรับรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดรายรับใหม่
 */
export function updateMonthlyIncome(year, month, value) {
	const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	if (!data.tax_by_year) data.tax_by_year = {};
	if (!data.tax_by_year[year]) {
		data.tax_by_year[year] = { accumulated_tax: 0, monthly_tax: {}, monthly_income: {} };
	}
	if (!data.tax_by_year[year].monthly_income) {
		data.tax_by_year[year].monthly_income = {};
	}
	data.tax_by_year[year].monthly_income[month] = value.toString();
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
import fs from 'fs';
import path from 'path';
/**
 * อัพเดตข้อมูลภาษีรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดภาษีใหม่
 */
export function updateMonthlyTax(year, month, value) {
	const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	if (!data.tax_by_year) data.tax_by_year = {};
	if (!data.tax_by_year[year]) {
		data.tax_by_year[year] = { accumulated_tax: 0, monthly_tax: {} };
	}
	if (!data.tax_by_year[year].monthly_tax) {
		data.tax_by_year[year].monthly_tax = {};
	}
	data.tax_by_year[year].monthly_tax[month] = value.toString();
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const filePath = path.join(process.cwd(), 'src', 'backend', 'data', 'tax_accumulated.json');

function cleanOldYearData(data) {
	const currentYear = new Date().getFullYear();
	const years = Object.keys(data.tax_by_year || {}).map(Number);
	const validYears = years.filter(year => year >= currentYear - 2);
	const newYearData = {};
	validYears.forEach(year => {
		if (data.tax_by_year && data.tax_by_year[year]) {
			newYearData[year] = data.tax_by_year[year];
		}
	});
	data.tax_by_year = newYearData;
	return data;
}

export default function handler(req, res) {
	if (req.method === 'GET') {
		const { year } = req.query;
		const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		if (year) {
			const yearData = data.tax_by_year?.[year] || { accumulated_tax: 0 };
			res.status(200).json({ [year]: yearData });
		} else {
			res.status(200).json(data);
		}
		} else if (req.method === 'POST') {
			const { year, accumulated_tax, monthly_tax, monthly_income } = req.body;
			let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			if (!data.tax_by_year) {
				data.tax_by_year = {};
			}
			if (year) {
				if (typeof accumulated_tax === 'object' && accumulated_tax !== null) {
					data.tax_by_year[year] = accumulated_tax;
				} else {
					if (!data.tax_by_year[year]) {
						data.tax_by_year[year] = {};
					}
					if (monthly_tax !== undefined) {
						if (!data.tax_by_year[year].monthly_tax) {
							data.tax_by_year[year].monthly_tax = {};
						}
						Object.assign(data.tax_by_year[year].monthly_tax, monthly_tax);
						const sum = Object.values(data.tax_by_year[year].monthly_tax)
							.map(v => parseFloat(v) || 0)
							.reduce((a, b) => a + b, 0);
						data.tax_by_year[year].accumulated_tax = sum;
					} else if (accumulated_tax !== undefined) {
						data.tax_by_year[year].accumulated_tax = parseFloat(accumulated_tax) || 0;
					}
					// เพิ่มการบันทึก monthly_income
					if (monthly_income !== undefined) {
						data.tax_by_year[year].monthly_income = { ...monthly_income };
					}
				}
			}
			// data = cleanOldYearData(data); // ปิดชั่วคราวเพื่อทดสอบ
			fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
			res.status(201).json({ success: true });
	} else if (req.method === 'DELETE') {
			try {
				const { year } = req.body;
				let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
				if (!data.tax_by_year) {
					data.tax_by_year = {};
					res.status(404).json({ success: false, message: 'ไม่พบข้อมูลภาษี' });
					return;
				}
				if (!year) {
					res.status(400).json({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
					return;
				}
				if (!data.tax_by_year[year]) {
					res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
					return;
				}
				delete data.tax_by_year[year];
				const remainingYears = Object.keys(data.tax_by_year);
				fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
				res.status(200).json({ 
					success: true, 
					message: `ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว`,
					remainingYears: remainingYears
				});
			} catch (error) {
				res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' });
			}
	} else {
		res.status(405).end();
	}
}