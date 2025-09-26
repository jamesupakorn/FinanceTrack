import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'src', 'backend', 'data', 'savings.json');

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
		const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
		const savingsList = data.savings_list[month] || [];
		const totalSavings = savingsList.reduce((sum, item) => {
			return sum + (parseFloat(item.amount) || 0);
		}, 0);
		const response = {
			total_savings: data.total_savings[month] || 0,
			savings_list: savingsList,
			totalSavings
		};
		res.status(200).json(response);
	} else if (req.method === 'POST') {
		const { month, total_savings, savings_list } = req.body;
		let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
		if (total_savings !== undefined) {
			data.total_savings[month] = total_savings;
		}
		if (savings_list !== undefined) {
			data.savings_list[month] = savings_list;
		}
		data = cleanOldMonthData(data);
		fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
		res.status(201).json({ success: true });
	} else {
		res.status(405).end();
	}
}