// Re-export API จาก backend structure
import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'src', 'backend', 'data', 'monthly_expense.json');

const cleanOldMonthData = (data, newMonth) => {
	const months = Object.keys(data.months || {});
	if (!months.includes(newMonth)) {
		months.push(newMonth);
	}
	months.sort((a, b) => b.localeCompare(a));
	const recentMonths = months.slice(0, 15);
	const cleanedData = { ...data };
	cleanedData.months = {};
	recentMonths.forEach(month => {
		if (data.months && data.months[month]) {
			cleanedData.months[month] = data.months[month];
		}
	});
	return cleanedData;
};

export default function handler(req, res) {
		if (req.method === 'GET') {
			const { month } = req.query;
			const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			if (month) {
				// คืนข้อมูลเฉพาะเดือนที่ระบุ
				const monthData = data.months[month] || {};
				let totalEstimate = 0;
				let totalActualPaid = 0;
				Object.values(monthData).forEach(item => {
					if (item && typeof item === 'object') {
						totalEstimate += parseFloat(item.estimate) || 0;
						totalActualPaid += parseFloat(item.actual) || 0;
					}
				});
				const response = {
					...data,
					months: { [month]: monthData },
					totalEstimate,
					totalActualPaid
				};
				res.status(200).json(response);
			} else {
				// คืนข้อมูลทุกเดือน (สำหรับ dropdown)
				res.status(200).json(data);
			}
	} else if (req.method === 'POST') {
		const { month, values } = req.body;
		const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		data.months[month] = values;
		const cleanedData = cleanOldMonthData(data, month);
		fs.writeFileSync(filePath, JSON.stringify(cleanedData, null, 2));
		res.status(201).json({ success: true });
	} else {
		res.status(405).end();
	}
}