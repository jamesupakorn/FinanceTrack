import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getDbPromise } from './mongodb';
import dataModeConfig from './dataMode.config';
import { normaliseBudgetThresholds } from '../src/shared/utils/frontend/monthlySummary';

const DATA_MODE = (dataModeConfig?.mode || 'json').toLowerCase();
const USERS_FILE = path.resolve(process.cwd(), 'src/backend/data/users.json');

/**
 * ปฏิเสธ userId ที่ไม่ใช่ string/ว่างเปล่า ก่อนถูกนำไปสร้าง Mongo filter หรือใช้ค้นหาใน JSON
 * แก้ช่องโหว่ cross-user write: normalizeUserId (userRequest.js) ที่ branch array คืนค่าดิบโดยไม่เช็ค
 * type — { "userId": [{"$ne": null}] } จะหลุดมาถึง findOne({ id: userId })/updateOne({ id: userId }, ...)
 * แบบไม่มีการ์อง ทำให้อ่าน/เขียนทับเอกสารผู้ใช้คนอื่นได้ใน Mongo mode (production) — เป็น structural
 * twin ของ creditCardStore.js:45-51 ที่ผ่าน security review มาแล้ว ไม่ได้คิดรูปแบบใหม่
 * throw แทนการคืน null เพื่อให้ทุก caller fail ดังชัดเจน แทนที่จะ match ศูนย์เอกสาร (JSON) หรือทุก
 * เอกสาร (Mongo ก่อนแก้)
 * (Stage 1.5 escalation re-review — OQ-RS-A, option A1)
 */
function assertUserScope(userId) {
  const normalised = typeof userId === 'string' ? userId.trim() : '';
  if (!normalised) throw new Error('userStore: userId is required');
  return normalised;
}

async function readUsersJson() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeUsersJson(users) {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

export async function loadUsers() {
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    return db.collection('users').find({}).toArray();
  }
  return readUsersJson();
}

export async function getUserById(userId) {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    return db.collection('users').findOne({ id: userId });
  }
  const users = await readUsersJson();
  return users.find(u => u.id === userId) || null;
}

export async function checkUserPassword(userId, password) {
  const user = await getUserById(userId);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export async function updateUserPassword(userId, newPassword) {
  assertUserScope(userId);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await db.collection('users').findOneAndUpdate(
      { id: userId },
      { $set: { passwordHash } },
      { returnDocument: 'after' }
    );
    if (!user) throw new Error('User not found');
    // ⚠ ห้ามคืน passwordHash กลับไปที่ API layer เด็ดขาด — destructure เฉพาะ 3 ฟิลด์นี้เท่านั้น
    return { id: user.id, displayName: user.displayName, avatar: user.avatar };
  }
  const users = await readUsersJson();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  users[idx] = { ...users[idx], passwordHash };
  await writeUsersJson(users);
  return { id: users[idx].id, displayName: users[idx].displayName, avatar: users[idx].avatar };
}

export async function getUserBankAccounts(userId) {
  assertUserScope(userId);
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  return user.bankAccounts || [];
}

export async function updateUserBankAccounts(userId, bankAccounts) {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await db.collection('users').findOneAndUpdate(
      { id: userId },
      { $set: { bankAccounts } },
      { returnDocument: 'after' }
    );
    if (!user) throw new Error('User not found');
    return { id: user.id, displayName: user.displayName, avatar: user.avatar, bankAccounts: user.bankAccounts };
  }
  const users = await readUsersJson();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  users[idx] = { ...users[idx], bankAccounts };
  await writeUsersJson(users);
  return { id: users[idx].id, displayName: users[idx].displayName, avatar: users[idx].avatar, bankAccounts: users[idx].bankAccounts };
}

/**
 * อ่านเกณฑ์สุขภาพงบประมาณของผู้ใช้ — defaulted-on-read เสมอ ไม่มีการเขียนตอนอ่าน (BR-DASH-009/E1)
 * normaliseBudgetThresholds เติมคีย์ที่ขาด/clamp ให้ปลอดภัยเสมอ มาจาก monthlySummary.js (M-3)
 */
export async function getUserBudgetThresholds(userId) {
  assertUserScope(userId);
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  return normaliseBudgetThresholds(user.budgetThresholds);
}

/**
 * บันทึกเกณฑ์สุขภาพงบประมาณ — structural twin ของ updateUserBankAccounts ด้านบน
 * ⚠ thresholds ที่รับเข้ามาต้อง validate + whitelist เป็น BUDGET_THRESHOLD_KEYS ทั้ง 5 คีย์มาก่อนแล้วที่
 * ชั้น route (pages/api/user-bank-accounts.js) — ฟังก์ชันนี้แค่บันทึกสิ่งที่ได้รับมาตรง ๆ ไม่ normalise/
 * กรองซ้ำ (M-1/M-2)
 */
export async function updateUserBudgetThresholds(userId, thresholds) {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await db.collection('users').findOneAndUpdate(
      { id: userId },
      { $set: { budgetThresholds: thresholds } },
      { returnDocument: 'after' }
    );
    if (!user) throw new Error('User not found');
    return { id: user.id, displayName: user.displayName, avatar: user.avatar, budgetThresholds: user.budgetThresholds };
  }
  const users = await readUsersJson();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  users[idx] = { ...users[idx], budgetThresholds: thresholds };
  await writeUsersJson(users);
  return { id: users[idx].id, displayName: users[idx].displayName, avatar: users[idx].avatar, budgetThresholds: users[idx].budgetThresholds };
}

export async function updateUserLineId(userId, lineUserId) {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await db.collection('users').findOneAndUpdate(
      { id: userId },
      { $set: { LineId: lineUserId } },
      { returnDocument: 'after' }
    );
    if (!user) return null;
    return { id: user.id, displayName: user.displayName, avatar: user.avatar, LineId: user.LineId };
  }
  const users = await readUsersJson();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], LineId: lineUserId };
  await writeUsersJson(users);
  return { id: users[idx].id, displayName: users[idx].displayName, avatar: users[idx].avatar, LineId: users[idx].LineId };
}
