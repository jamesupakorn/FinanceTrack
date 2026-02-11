#!/usr/bin/env node
const { MongoClient } = require('mongodb');

const DATABASE_NAME = process.env.MONGODB_DB || 'financetrack';
const COLLECTION_CONFIGS = [
  { name: 'monthly_income', keyField: 'month', sampleSize: 3 },
  { name: 'monthly_expense', keyField: 'month', sampleSize: 3 },
  { name: 'salary', keyField: 'month', sampleSize: 3 },
  { name: 'savings', keyField: 'month', sampleSize: 3 },
  { name: 'investment', keyField: 'month', sampleSize: 3 },
  { name: 'tax_accumulated', keyField: 'year', sampleSize: 3 }
];

const verbose = process.argv.includes('--verbose');

if (!process.env.MONGODB_URI) {
  console.error('Missing MONGODB_URI. Please set it via environment variable or .env.local');
  process.exit(1);
}

async function summarizeCollection(db, config) {
  const collection = db.collection(config.name);
  const count = await collection.countDocuments();
  const projection = { userId: 1, [config.keyField]: 1 };
  const sortDirection = config.sortDirection || -1;
  const sample = count && config.sampleSize
    ? await collection.find({}, { projection }).sort({ [config.keyField]: sortDirection }).limit(config.sampleSize).toArray()
    : [];
  return { count, sample };
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);
    console.log(`\nMongoDB overview for database "${DATABASE_NAME}"`);

    for (const config of COLLECTION_CONFIGS) {
      const { count, sample } = await summarizeCollection(db, config);
      console.log(`\n- ${config.name}: ${count} documents`);
      if (sample.length) {
        sample.forEach((doc) => {
          const keyValue = doc[config.keyField];
          const userId = doc.userId || '(no user)';
          console.log(`   • ${userId} → ${config.keyField}: ${keyValue}`);
          if (verbose) {
            console.log(`     ${JSON.stringify(doc)}`);
          }
        });
      } else {
        console.log('   (no sample data)');
      }
    }

    console.log('\nDone.');
  } catch (error) {
    console.error('Failed to summarize collections:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
