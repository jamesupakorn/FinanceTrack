#!/usr/bin/env node
/**
 * seedUsers.js
 * อัปเซิร์ต user records จาก hardcoded snapshot เข้า MongoDB users collection
 * ใช้ครั้งเดียวหลังจาก users.json ถูกลบในการ migrate ไป MongoDB
 *
 * Usage:
 *   node scripts/seedUsers.js
 *   node scripts/seedUsers.js --dry-run
 */

const { MongoClient } = require('mongodb');

const DATABASE_NAME = process.env.MONGODB_DB || 'financetrack';
const isDryRun = process.argv.includes('--dry-run');

// Snapshot ของ users จาก git history (ก่อน users.json ถูกลบใน commit 3d6f236)
const USERS_SNAPSHOT = [
  {
    id: 'u001',
    displayName: 'JAME',
    avatar: '/avatars/u001.jpg',
    passwordHash: '$2a$10$B5KBN7T4DkYgqmg33beZi.x7b3Gzt8jaEHSOgSvlN8LKnsMv87z3W',
    LineId: 'U8123a5c8aada628470ca09765d32594d',
    bankAccounts: ['กรุงศรี', 'ttb', 'กสิกร', 'UOB'],
  },
  {
    id: 'u002',
    displayName: 'MUHAM',
    avatar: '/avatars/u002.jpeg',
    passwordHash: '$2a$10$LOXxLTyAOtrmYwAdDVA3BulvGrqpBKPtYXgpIN4FT942G0ajKYrOq',
    bankAccounts: [],
  },
];

if (!process.env.MONGODB_URI) {
  console.error('Missing MONGODB_URI. Set it in .env.local or as env var.');
  process.exit(1);
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);
    const col = db.collection('users');

    console.log(`\nSeed users → MongoDB [db: ${DATABASE_NAME}]${isDryRun ? '  (dry-run)' : ''}`);

    for (const user of USERS_SNAPSHOT) {
      const existing = await col.findOne({ id: user.id });
      if (existing) {
        console.log(` - ${user.id} (${user.displayName}) → already exists, skipping`);
        continue;
      }
      if (!isDryRun) {
        await col.insertOne(user);
      }
      console.log(` - ${user.id} (${user.displayName}) → ${isDryRun ? '[dry-run] would insert' : 'inserted'}`);
    }

    console.log(isDryRun ? '\nDry-run complete.' : '\nSeed complete.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
