#!/usr/bin/env node
/**
 * exportMongoToJson.js
 * ดึงข้อมูลจาก MongoDB → เขียนลง src/backend/data/*.json
 * reverse ของ importJsonToMongo.js
 *
 * Usage:
 *   node scripts/exportMongoToJson.js
 *   node scripts/exportMongoToJson.js --dry-run   (แสดงจำนวนเท่านั้น ไม่เขียนไฟล์)
 *   node scripts/exportMongoToJson.js --collection savings
 */

const fs = require('fs/promises');
const path = require('path');
const { MongoClient } = require('mongodb');

const DATA_DIR = path.resolve(process.cwd(), 'src/backend/data');
const DATABASE_NAME = process.env.MONGODB_DB || 'financetrack';

const COLLECTION_CONFIGS = [
  { name: 'monthly_income',   file: 'monthly_income.json',   keyField: 'month' },
  { name: 'monthly_expense',  file: 'monthly_expense.json',  keyField: 'month' },
  { name: 'salary',           file: 'salary.json',           keyField: 'month' },
  { name: 'savings',          file: 'savings.json',          keyField: 'month' },
  { name: 'investment',       file: 'investment.json',       keyField: 'month' },
  { name: 'tax_accumulated',  file: 'tax_accumulated.json',  keyField: 'year'  },
];

const isDryRun   = process.argv.includes('--dry-run');
const filterCol  = process.argv.includes('--collection')
  ? process.argv[process.argv.indexOf('--collection') + 1]
  : null;

if (!process.env.MONGODB_URI) {
  console.error('Missing MONGODB_URI. Set it in .env.local or as env var.');
  process.exit(1);
}

/**
 * แปลง flat docs array → nested { userId: { keyValue: { ...doc } } }
 * (reverse ของ flattenDocs ใน importJsonToMongo.js)
 */
function nestDocs(docs, keyField) {
  const result = {};
  for (const doc of docs) {
    const userId   = doc.userId;
    const keyValue = doc[keyField];
    if (!userId || !keyValue) continue;

    if (!result[userId]) result[userId] = {};
    // เก็บ doc ทั้งหมด (รวม userId, _id) ให้ตรงกับ format เดิม
    result[userId][keyValue] = doc;
  }
  return result;
}

async function exportCollection(db, config) {
  const col  = db.collection(config.name);
  const docs = await col.find({}).toArray();

  // แปลง MongoDB ObjectId → string ถ้ามี
  const cleaned = docs.map(d => {
    const doc = { ...d };
    if (doc._id && typeof doc._id === 'object') {
      doc._id = doc._id.toString();
    }
    return doc;
  });

  const nested = nestDocs(cleaned, config.keyField);

  if (!isDryRun) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const outPath = path.join(DATA_DIR, config.file);
    await fs.writeFile(outPath, JSON.stringify(nested, null, 2), 'utf-8');
  }

  return { docs: docs.length, users: Object.keys(nested).length };
}

async function run() {
  const configs = filterCol
    ? COLLECTION_CONFIGS.filter(c => c.name === filterCol)
    : COLLECTION_CONFIGS;

  if (filterCol && configs.length === 0) {
    console.error(`Collection "${filterCol}" not found in config.`);
    console.error('Available:', COLLECTION_CONFIGS.map(c => c.name).join(', '));
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);

    console.log(`\nExporting MongoDB → JSON  [db: ${DATABASE_NAME}]${isDryRun ? '  (dry-run)' : ''}`);

    for (const config of configs) {
      process.stdout.write(` - ${config.name} → ${config.file} ... `);
      const { docs, users } = await exportCollection(db, config);
      console.log(`${docs} docs · ${users} users`);
    }

    console.log(isDryRun ? '\nDry-run complete (no files written).' : '\nExport complete.');
  } catch (err) {
    console.error('Export failed:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
