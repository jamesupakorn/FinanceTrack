#!/usr/bin/env node
/*
 * Utility script: adds a userId field to legacy MongoDB documents so that
 * newly enforced per-user APIs continue to work without manual cleanup.
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://..." node scripts/migrateMongoUserIds.js u001            (dry-run)
 *   MONGODB_URI="mongodb+srv://..." node scripts/migrateMongoUserIds.js u001 --apply    (writes)
 */

const { MongoClient } = require('mongodb');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const TARGET_USER_ID = args.find(arg => !arg.startsWith('--')) || process.env.DEFAULT_USER_ID || 'u001';
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

  let primaryMatched;
  let primaryModified;
  if (apply) {
    const primaryResult = await collection.updateMany(baseFilter, updateDoc);
    primaryMatched = primaryResult.matchedCount;
    primaryModified = primaryResult.modifiedCount;
  } else {
    // Dry run: report real counts via countDocuments on the same filter the real
    // updateMany would use, rather than skipping the query entirely.
    primaryMatched = await collection.countDocuments(baseFilter);
    primaryModified = primaryMatched;
  }

  const extraResults = [];

  if (Array.isArray(config.extraFilters)) {
    for (const extraFilter of config.extraFilters) {
      const filter = { userId: { $exists: false }, ...extraFilter };
      let matched;
      let modified;
      if (apply) {
        const result = await collection.updateMany(filter, updateDoc);
        matched = result.matchedCount;
        modified = result.modifiedCount;
      } else {
        matched = await collection.countDocuments(filter);
        modified = matched;
      }
      extraResults.push({ filter: extraFilter, matched, modified });
    }
  }

  return {
    name: config.name,
    matched: primaryMatched,
    modified: primaryModified,
    extras: extraResults
  };
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);

    console.log(`\nRunning Mongo userId migration for database "${DATABASE_NAME}" → userId: ${TARGET_USER_ID}`);
    if (!apply) {
      console.log('Dry run only — no write performed. Re-run with --apply to persist these changes.');
    }

    const summary = [];
    for (const config of COLLECTION_CONFIGS) {
      const result = await migrateCollection(db, config);
      summary.push(result);
      const verb = apply ? 'updated' : 'would update';
      console.log(` - ${config.name}: ${verb} ${result.modified}/${result.matched} documents`);
      result.extras.forEach((extra) => {
        console.log(`   • extra filter ${JSON.stringify(extra.filter)} → ${extra.modified}/${extra.matched}`);
      });
    }

    console.log(apply ? '\nMigration complete. Summary:' : '\nDry run complete. Summary (would update):');
    summary.forEach((item) => {
      console.log(` * ${item.name}: ${apply ? 'modified' : 'would modify'} ${item.modified}/${item.matched}`);
    });
    if (apply) {
      console.log('\nReminder: verify the data per user inside the app, then remove or archive any shared documents that should remain public.');
    } else {
      console.log('\nRe-run with --apply to persist these changes.');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
