#!/usr/bin/env node
/**
 * MongoDB Setup Script: loginAttempts Collection (TD-H10, login rate limiting)
 * File: scripts/setupLoginAttemptsCollection.js
 *
 * Creates the `loginAttempts` collection with a TTL index on `expiresAt` so idle counter
 * documents self-clean (no separate cron/cleanup job needed). One document per composite
 * `${clientIp}|${userId}` key — see src/shared/utils/backend/loginRateLimit.js for the shape
 * and read/write logic.
 *
 * No schema validator (unlike setupSavingsGoalsCollection.js) — this data never reaches the
 * client and doesn't need the same integrity guarantees as financial records; keeping it
 * lightweight since it's purely an internal throttling counter.
 *
 * Usage: node scripts/setupLoginAttemptsCollection.js
 */

const { getDbPromise } = require('../lib/mongodb');

const COLLECTION_NAME = 'loginAttempts';

async function setupLoginAttemptsCollection() {
  const db = await getDbPromise();

  const collections = await db.listCollections({ name: COLLECTION_NAME }).toArray();
  if (collections.length === 0) {
    console.log(`Creating "${COLLECTION_NAME}" collection...`);
    await db.createCollection(COLLECTION_NAME);
    console.log('✓ Collection created.');
  } else {
    console.log(`"${COLLECTION_NAME}" collection already exists — skipping creation.`);
  }

  console.log(`Creating TTL index on ${COLLECTION_NAME}.expiresAt...`);
  // expireAfterSeconds: 0 → Mongo deletes a document as soon as its own `expiresAt` timestamp
  // is in the past (each doc's expiry is set individually by the app on every write, rather than
  // a fixed offset from insertion time — see loginRateLimit.js).
  await db.collection(COLLECTION_NAME).createIndex(
    { expiresAt: 1 },
    { name: 'idx_expiresAt_ttl', expireAfterSeconds: 0 }
  );
  console.log('✓ TTL index ready.');

  console.log(`\n✅ "${COLLECTION_NAME}" setup complete.`);
}

setupLoginAttemptsCollection()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Setup failed:', err);
    process.exit(1);
  });
