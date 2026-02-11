#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { MongoClient } = require('mongodb');

const DATA_DIR = path.resolve(process.cwd(), 'src/backend/data');
const DATABASE_NAME = process.env.MONGODB_DB || 'financetrack';

const COLLECTION_CONFIGS = [
  { name: 'monthly_income', file: 'monthly_income.json', keyField: 'month' },
  { name: 'monthly_expense', file: 'monthly_expense.json', keyField: 'month' },
  { name: 'salary', file: 'salary.json', keyField: 'month', skipKeys: ['months'] },
  { name: 'savings', file: 'savings.json', keyField: 'month' },
  { name: 'investment', file: 'investment.json', keyField: 'month' },
  { name: 'tax_accumulated', file: 'tax_accumulated.json', keyField: 'year' }
];

const shouldDrop = process.argv.includes('--drop');

if (!process.env.MONGODB_URI) {
  console.error('Missing MONGODB_URI. Please set it via environment variable or .env.local');
  process.exit(1);
}

async function loadJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.error(`Failed to read ${filename}:`, error.message);
    return {};
  }
}

function flattenDocs(jsonData, { keyField, skipKeys = [] }) {
  if (!jsonData || typeof jsonData !== 'object') {
    return [];
  }
  const docs = [];
  Object.entries(jsonData).forEach(([userId, bucket]) => {
    if (!bucket || typeof bucket !== 'object') return;
    Object.entries(bucket).forEach(([entryKey, value]) => {
      if (skipKeys.includes(entryKey)) return;
      if (!value || typeof value !== 'object') return;
      const doc = { ...value };
      if (!doc[keyField]) {
        doc[keyField] = entryKey;
      }
      doc.userId = userId;
      docs.push(doc);
    });
  });
  return docs;
}

async function importCollection(db, config) {
  const data = await loadJson(config.file);
  const docs = flattenDocs(data, config);
  if (!docs.length) {
    console.warn(`No documents found for ${config.file}, skipping.`);
    return { inserted: 0 };
  }

  const collection = db.collection(config.name);
  if (shouldDrop) {
    await collection.deleteMany({});
  }

  const operations = docs.map((doc) => ({
    replaceOne: {
      filter: {
        userId: doc.userId,
        [config.keyField]: doc[config.keyField]
      },
      replacement: doc,
      upsert: true
    }
  }));

  const result = await collection.bulkWrite(operations, { ordered: false });
  const upserts = result.upsertedCount || 0;
  const modifications = result.modifiedCount || 0;
  return { inserted: upserts, updated: modifications };
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);
    console.log(`\nImporting JSON data into MongoDB database "${DATABASE_NAME}"${shouldDrop ? ' (collections cleared before insert)' : ''}`);

    for (const config of COLLECTION_CONFIGS) {
      process.stdout.write(` - ${config.name} (${config.file}) ... `);
      const result = await importCollection(db, config);
      const parts = [`${result.inserted} insert`];
      if (result.updated) {
        parts.push(`${result.updated} update`);
      }
      console.log(parts.join(', '));
    }

    console.log('\nImport complete.');
  } catch (error) {
    console.error('Import failed:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
