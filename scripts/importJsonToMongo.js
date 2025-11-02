// นำเข้า JSON ทั้งหมดใน src/backend/data ลง MongoDB Atlas
// ใช้: node scripts/importJsonToMongo.js

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Vercel-Admin-financetrack:sGXm0Wl35MhD4ANu@financetrack.txujoc6.mongodb.net/financetrack';
const DB_NAME = 'financetrack';
const DATA_DIR = path.join(__dirname, '../src/backend/data');

const fileToCollection = {
  'monthly_income.json': 'monthly_income',
  'monthly_expense.json': 'monthly_expense',
  'salary.json': 'salary',
  'savings.json': 'savings',
  'tax_accumulated.json': 'tax_accumulated',
  'investment.json': 'investment',
};

async function importFile(file, collectionName, db) {
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  let data = JSON.parse(raw);

  // Custom logic for each file type
  let docs = [];
  if (collectionName === 'monthly_income' || collectionName === 'monthly_expense') {
    // Import each month as a separate document, and if key is 'items' or 'months', use obj: ...
    if (data.months && typeof data.months === 'object') {
      for (const [month, values] of Object.entries(data.months)) {
        docs.push({ month, ...values });
      }
    }
    // Also import 'items' and 'months' as obj: ...
    if (data.items) {
      docs.push({ obj: 'items', items: data.items });
    }
    if (data.months) {
      docs.push({ obj: 'months', months: data.months });
    }
  } else if (collectionName === 'savings') {
    // total_savings: { month: value }, savings_list: { month: [...] }
    const months = new Set([
      ...Object.keys(data.total_savings || {}),
      ...Object.keys(data.savings_list || {})
    ]);
    for (const month of months) {
      docs.push({
        month,
        total_savings: data.total_savings && data.total_savings[month] !== undefined ? data.total_savings[month] : 0,
        savings_list: data.savings_list && data.savings_list[month] ? data.savings_list[month] : []
      });
    }
  } else if (collectionName === 'tax_accumulated') {
    // tax_by_year: { year: {...} }
    if (data.tax_by_year && typeof data.tax_by_year === 'object') {
      for (const [year, values] of Object.entries(data.tax_by_year)) {
        docs.push({ year, ...values });
      }
    }
  } else if (Array.isArray(data)) {
    docs = data;
  } else if (typeof data === 'object') {
    // fallback: import each key as a doc
    docs = Object.keys(data).map(key => ({ ...data[key], [collectionName === 'tax_accumulated' ? 'year' : 'month']: key }));
  }

  if (docs.length > 0) {
    await db.collection(collectionName).deleteMany({});
    await db.collection(collectionName).insertMany(docs);
    console.log(`Imported ${docs.length} docs to ${collectionName}`);
  }
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  for (const [file, collection] of Object.entries(fileToCollection)) {
    await importFile(file, collection, db);
  }
  await client.close();
  console.log('All done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
