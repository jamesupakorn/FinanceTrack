#!/usr/bin/env node
/**
 * seedUsers.js
 * อัปเซิร์ต user records จาก hardcoded snapshot เข้า MongoDB users collection
 * ใช้ครั้งเดียวหลังจาก users.json ถูกลบในการ migrate ไป MongoDB
 *
 * Usage:
 *   node scripts/seedUsers.js            (dry-run — prints what would be inserted)
 *   node scripts/seedUsers.js --apply    (writes to MongoDB)
 */

const { MongoClient } = require('mongodb');

const DATABASE_NAME = process.env.MONGODB_DB || 'financetrack';
const apply = process.argv.includes('--apply');

// Snapshot ของ users จาก git history (ก่อน users.json ถูกลบใน commit 3d6f236)
const USERS_SNAPSHOT = [
  {
    id: 'u001',
    displayName: 'JAME',
    avatar: '/avatars/u001.jpg',
    passwordHash: '$2a$10$B5KBN7T4DkYgqmg33beZi.x7b3Gzt8jaEHSOgSvlN8LKnsMv87z3W',
    // Placeholder/synthetic value only — NOT a real LINE user identity. Do not restore the old one.
    LineId: 'U00000000000000000000000000000001',
    bankAccounts: ['กรุงศรี', 'ttb', 'กสิกร', 'UOB'],
  },
  {
    id: 'u002',
    displayName: 'MUHAM',
    avatar: '/avatars/u002.jpeg',
    passwordHash: '$2a$10$LOXxLTyAOtrmYwAdDVA3BulvGrqpBKPtYXgpIN4FT942G0ajKYrOq',
    bankAccounts: [],
  },
  {
    // TD-H09: real server-side demo user — restores "ทดลองใช้" login through the normal
    // /api/auth/profile-login path (see .pipeline/spec-demo-profile-login-fix.md §1).
    // `isDemo: true` is the only new field this task adds; passwordHash is never read for
    // this user (profile-login.js gates the passwordless branch strictly on `user.isDemo`).
    id: 'demo',
    displayName: 'บัญชีสาธิต (Demo)',
    avatar: '',
    isDemo: true,
    passwordHash: null,
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

    console.log(`\nSeed users → MongoDB [db: ${DATABASE_NAME}]${!apply ? '  (dry-run)' : ''}`);
    if (!apply) {
      console.log('Dry run only — no write performed. Re-run with --apply to persist these changes.');
    }

    for (const user of USERS_SNAPSHOT) {
      const existing = await col.findOne({ id: user.id });
      if (existing) {
        console.log(` - ${user.id} (${user.displayName}) → already exists, skipping`);
        continue;
      }
      if (apply) {
        await col.insertOne(user);
      }
      console.log(` - ${user.id} (${user.displayName}) → ${apply ? 'inserted' : '[dry-run] would insert'}`);
    }

    console.log(apply ? '\nSeed complete.' : '\nDry-run complete.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
