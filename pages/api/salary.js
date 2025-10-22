import fs from 'fs';
import path from 'path';
// updateMonthlyTax ต้องแก้ import path หลังย้าย
import { updateMonthlyTax, updateMonthlyIncome } from './tax_accumulated';

const dataPath = path.join(process.cwd(), 'src', 'backend', 'data', 'salary.json');

function cleanOldMonthData(data) {
	const sortedKeys = Object.keys(data).sort((a, b) => new Date(a) - new Date(b));
	if (sortedKeys.length > 15) {
		const keysToRemove = sortedKeys.slice(0, sortedKeys.length - 15);
		keysToRemove.forEach(key => delete data[key]);
	}
	return data;
}

function readSalaryData() {
	try {
		if (!fs.existsSync(dataPath)) {
			const initialData = {};
			fs.writeFileSync(dataPath, JSON.stringify(initialData, null, 2));
			return initialData;
		}
		const data = fs.readFileSync(dataPath, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		console.error('Error reading salary data:', error);
		return {};
	}
}

function writeSalaryData(data) {
	try {
		data = cleanOldMonthData(data);
		fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
		return true;
	} catch (error) {
		console.error('Error writing salary data:', error);
		return false;
	}
}

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

function calculateSummary(salaryData) {
	const total_income = Object.values(salaryData.income || {}).reduce(
		(sum, val) => sum + (parseFloat(val) || 0), 0
	);
	const total_deduct = Object.values(salaryData.deduct || {}).reduce(
		(sum, val) => sum + (parseFloat(val) || 0), 0
	);
	const net_income = total_income - total_deduct;
	return {
		total_income,
		total_deduct,
		net_income
	};
}

export default function handler(req, res) {
	try {
		const allData = readSalaryData();
		if (req.method === 'GET') {
			const { month } = req.query;
			if (month) {
				let dataToReturn = allData[month];
				// ถ้าไม่มีข้อมูลเลย (undefined/null) ให้สร้างใหม่
				if (!dataToReturn) {
					dataToReturn = createDefaultSalaryStructure();
					allData[month] = dataToReturn;
					writeSalaryData(allData);
				} else {
					// ถ้า income/deduct เป็น object ว่าง ให้ fallback เป็น default structure
					const isIncomeEmpty = !dataToReturn.income || Object.keys(dataToReturn.income).length === 0;
					const isDeductEmpty = !dataToReturn.deduct || Object.keys(dataToReturn.deduct).length === 0;
					if (isIncomeEmpty || isDeductEmpty) {
						dataToReturn = createDefaultSalaryStructure();
						allData[month] = dataToReturn;
						writeSalaryData(allData);
					}
				}
				const total_income = Object.values(dataToReturn.income || {}).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
				const total_deduct = Object.values(dataToReturn.deduct || {}).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
				const net_income = total_income - total_deduct;
				return res.json({
					...dataToReturn,
					summary: { total_income, total_deduct, net_income }
				});
			} else {
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
			salaryData.summary = calculateSummary(salaryData);
			allData[month] = salaryData;
			writeSalaryData(allData);
									// อัพเดตภาษีสะสมและรายรับสะสม (ใช้ปี ค.ศ. ตามที่ตกลง)
									// month = YYYY-MM, ต้องแยกเป็นปี ค.ศ. และเลขเดือน
									if (month) {
											const [yearAD, monthNum] = month.split('-');
											if (salaryData.deduct.tax !== undefined) {
												updateMonthlyTax(yearAD, monthNum.padStart(2, '0'), salaryData.deduct.tax);
											}
											if (salaryData.summary && salaryData.summary.total_income !== undefined) {
												updateMonthlyIncome(yearAD, monthNum.padStart(2, '0'), salaryData.summary.total_income);
											}
									}
			return res.status(201).json({ success: true });
		} else if (req.method === 'DELETE') {
			const { month } = req.query;
			if (!month) {
				return res.status(400).json({ error: 'กรุณาระบุเดือนที่ต้องการลบ' });
			}
			if (allData[month]) {
				delete allData[month];
				if (writeSalaryData(allData)) {
					return res.json({ 
						success: true, 
						message: 'ลบข้อมูลเงินเดือนเรียบร้อย' 
					});
				} else {
					return res.status(500).json({ error: 'ไม่สามารถลบข้อมูลได้' });
				}
			} else {
				return res.status(404).json({ error: 'ไม่พบข้อมูลเดือนที่ระบุ' });
			}
		} else {
			res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
			return res.status(405).json({ error: 'Method not allowed' });
		}
	} catch (error) {
		console.error('Salary API Error:', error);
		return res.status(500).json({ 
			error: 'เกิดข้อผิดพลาดในระบบ',
			details: error.message 
		});
	}
}