#!/usr/bin/env node
/*
 * Utility script: adds a userId field to legacy MongoDB documents so that
 * newly enforced per-user APIs continue to work without manual cleanup.
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://..." node scripts/migrateMongoUserIds.js u001
 */

const { MongoClient } = require('mongodb');

const TARGET_USER_ID = process.argv[2] || process.env.DEFAULT_USER_ID || 'u001';
const DATABASE_NAME = process.env.MONGODB_DB || 'financetrack';

if (!process.env.MONGODB_URI) {
  console.error('Missing MONGODB_URI. Please set it via environment variable.');
  process.exit(1);
}

const COLLECTION_CONFIGS = [
  {
    name: 'monthly_income',
    filter: { month: { $exists: true } },
    extraFilters: [{ obj: 'months' }]
  },
  {
    name: 'monthly_expense',
    filter: { month: { $exists: true } }
  },
  {
    name: 'salary',
    filter: { month: { $exists: true } }
  },
  {
    name: 'savings',
    filter: { month: { $exists: true } }
  },
  {
    name: 'investment',
    filter: { month: { $exists: true } }
  },
  {
    name: 'tax_accumulated',
    filter: { year: { $exists: true } }
  }
];

async function migrateCollection(db, config) {
  const collection = db.collection(config.name);
  const baseFilter = { userId: { $exists: false }, ...(config.filter || {}) };
  const updateDoc = { $set: { userId: TARGET_USER_ID } };

  const primaryResult = await collection.updateMany(baseFilter, updateDoc);
  const extraResults = [];

  if (Array.isArray(config.extraFilters)) {
    for (const extraFilter of config.extraFilters) {
      const filter = { userId: { $exists: false }, ...extraFilter };
      const result = await collection.updateMany(filter, updateDoc);
      extraResults.push({ filter: extraFilter, matched: result.matchedCount, modified: result.modifiedCount });
    }
  }

  return {
    name: config.name,
    matched: primaryResult.matchedCount,
    modified: primaryResult.modifiedCount,
    extras: extraResults
  };
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);

    console.log(`\nRunning Mongo userId migration for database "${DATABASE_NAME}" → userId: ${TARGET_USER_ID}`);

    const summary = [];
    for (const config of COLLECTION_CONFIGS) {
      const result = await migrateCollection(db, config);
      summary.push(result);
      console.log(` - ${config.name}: updated ${result.modified}/${result.matched} documents`);
      result.extras.forEach((extra) => {
        console.log(`   • extra filter ${JSON.stringify(extra.filter)} → ${extra.modified}/${extra.matched}`);
      });
    }

    console.log('\nMigration complete. Summary:');
    summary.forEach((item) => {
      console.log(` * ${item.name}: modified ${item.modified}/${item.matched}`);
    });
    console.log('\nReminder: verify the data per user inside the app, then remove or archive any shared documents that should remain public.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
