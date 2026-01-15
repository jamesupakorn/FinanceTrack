const path = require('path');
const fs = require('fs/promises');
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'financetrack';

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is required');
}

const EXPORT_CONFIG = [
  { collection: 'monthly_income', file: 'src/backend/data/monthly_income.json', sort: { month: -1 } },
  { collection: 'monthly_expense', file: 'src/backend/data/monthly_expense.json', sort: { month: -1 } },
  { collection: 'salary', file: 'src/backend/data/salary.json', sort: { month: -1 } },
  { collection: 'savings', file: 'src/backend/data/savings.json', sort: { month: -1 } },
  { collection: 'investment', file: 'src/backend/data/investment.json', sort: { month: -1 } },
  { collection: 'tax_accumulated', file: 'src/backend/data/tax_accumulated.json', sort: { year: -1 } }
];

function sanitizeDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = { ...doc };
  if (out._id && typeof out._id === 'object' && typeof out._id.toString === 'function') {
    out._id = out._id.toString();
  }
  return out;
}

async function exportCollection(db, config) {
  const { collection, file, sort } = config;
  const docs = await db.collection(collection).find({}).sort(sort || {}).toArray();
  const sanitized = docs.map(sanitizeDoc);
  const filePath = path.resolve(process.cwd(), file);
  await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf-8');
  console.log(`Exported ${sanitized.length} docs from ${collection} -> ${file}`);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  for (const config of EXPORT_CONFIG) {
    await exportCollection(db, config);
  }

  await client.close();
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
