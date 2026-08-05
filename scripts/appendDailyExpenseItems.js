#!/usr/bin/env node
// One-off: append daily_expenses items from one month onto another month's existing items,
// for one user only. Existing items in the target month are kept, not overwritten.
// Usage: node scripts/appendDailyExpenseItems.js --userId u001 --from 2026-06 --to 2026-08 [--apply]
// Without --apply it only prints what would change (dry run).
const { MongoClient } = require('mongodb');

const DATABASE_NAME = process.env.MONGODB_DB || 'financetrack';

const BOOLEAN_FLAGS = new Set(['apply']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        args[key] = true;
        continue;
      }
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function run() {
  const { userId, from, to, apply } = parseArgs(process.argv.slice(2));
  if (!userId || !from || !to) {
    console.error('Usage: node scripts/appendDailyExpenseItems.js --userId <id> --from <YYYY-MM> --to <YYYY-MM> [--apply]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI. Please set it via environment variable or .env.local');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);
    const collection = db.collection('daily_expenses');

    const sourceDoc = await collection.findOne({ userId, month: from });
    if (!sourceDoc || !Array.isArray(sourceDoc.items) || !sourceDoc.items.length) {
      console.error(`No daily_expenses items found for userId=${userId}, month=${from}. Nothing to copy.`);
      process.exit(1);
    }

    const targetDoc = await collection.findOne({ userId, month: to });
    const existingItems = (targetDoc && Array.isArray(targetDoc.items)) ? targetDoc.items : [];

    const newItems = sourceDoc.items.map((item) => ({
      ...item,
      id: genId()
    }));
    const combinedItems = [...existingItems, ...newItems];

    console.log(`Existing items in ${to} (kept):`, JSON.stringify(existingItems, null, 2));
    console.log(`\nItems copied from ${from} (appended):`, JSON.stringify(newItems, null, 2));
    console.log(`\nResulting ${to} item count: ${combinedItems.length}`);

    if (!apply) {
      console.log('\nDry run only — no write performed. Re-run with --apply to persist this change.');
      return;
    }

    await collection.updateOne(
      { userId, month: to },
      { $set: { items: combinedItems, updatedAt: new Date().toISOString() }, $setOnInsert: { userId, month: to } },
      { upsert: true }
    );
    console.log(`\nDone. Appended ${newItems.length} item(s) from ${from} into ${to} for userId=${userId}.`);
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error('Failed:', error);
  process.exit(1);
});
