import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'src/backend/data/investment.json');

function readData() {
  if (!fs.existsSync(DATA_PATH)) return {};
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export default function handler(req, res) {
  if (req.method === 'GET') {
    const { month } = req.query;
    const data = readData();
    if (month) {
      return res.status(200).json(data[month] || []);
    }
    return res.status(200).json(data);
  }
  if (req.method === 'POST') {
    const { month, investments } = req.body;
    if (!month || !Array.isArray(investments)) {
      return res.status(400).json({ error: 'month and investments required' });
    }
    const data = readData();
    data[month] = investments;
    writeData(data);
    return res.status(200).json({ success: true });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
