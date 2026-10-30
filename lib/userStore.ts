import path from 'path';
import bcrypt from 'bcryptjs';
import type { Document } from 'mongodb';
import { getDbPromise } from './mongodb';
import { dataDir, jsonRead, jsonWrite, runJsonBookkeeping } from './auditJsonStore';
import { wrapCollection } from './auditContext';
import dataModeConfig from './dataMode.config';
import { normaliseBudgetThresholds } from '../src/shared/utils/frontend/monthlySummary';
import { assertScopedUserId } from '../src/shared/utils/backend/userRequest';
import { normaliseBankAccounts } from '../src/shared/utils/backend/bankAccountIds';
import { toBankAccountNames, type BankAccount } from '../src/shared/utils/bankAccountShape';

const DATA_MODE = (dataModeConfig?.mode || 'json').toLowerCase();
const usersFile = (): string => path.join(dataDir(), 'users.json');
type BudgetThresholds = ReturnType<typeof normaliseBudgetThresholds>;

export interface UserRecord extends Document {
  id: string;
  displayName: string;
  passwordHash: string;
  avatar?: string | null;
  bankAccounts?: unknown[];
  budgetThresholds?: unknown;
  monthlySummaryEnabled?: boolean;
  lastMonthlySummarySent?: string;
  LineId?: string;
}

export interface PublicUser {
  id: string;
  displayName: string;
  avatar?: string | null;
}

/**
 * ปฏิเสธ userId ที่ไม่ใช่ string/ว่างเปล่า ก่อนถูกนำไปสร้าง Mongo filter หรือใช้ค้นหาใน JSON
 * แก้ช่องโหว่ cross-user write: normalizeUserId (userRequest.js) ที่ branch array คืนค่าดิบโดยไม่เช็ค
 * type — { "userId": [{"$ne": null}] } จะหลุดมาถึง findOne({ id: userId })/updateOne({ id: userId }, ...)
 * แบบไม่มีการ์อง ทำให้อ่าน/เขียนทับเอกสารผู้ใช้คนอื่นได้ใน Mongo mode (production) — เป็น structural
 * twin ของ creditCardStore.js:45-51 ที่ผ่าน security review มาแล้ว ไม่ได้คิดรูปแบบใหม่
 * throw แทนการคืน null เพื่อให้ทุก caller fail ดังชัดเจน แทนที่จะ match ศูนย์เอกสาร (JSON) หรือทุก
 * เอกสาร (Mongo ก่อนแก้)
 * (Stage 1.5 escalation re-review — OQ-RS-A, option A1)
 * (F-08: implementation moved to shared src/shared/utils/backend/userRequest.js#assertScopedUserId
 * — this file only supplies its own error-message label so existing tests keep asserting the
 * literal string 'userStore: userId is required'.)
 */
function assertUserScope(userId: unknown): string {
  return assertScopedUserId(userId, 'userStore');
}

/** JSON-only synchronous read of users.json — for scripts and tests that run outside the request path. */
export function loadUsersJson(): UserRecord[] {
  try {
    const raw = jsonRead(usersFile());
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as UserRecord[] : [];
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/** JSON-only synchronous write of users.json (audited via jsonWrite). */
export function saveUsers(users: UserRecord[] = []): void {
  jsonWrite(usersFile(), JSON.stringify(users, null, 2));
}

const USER_ID_PREFIX = 'u';
const USER_ID_PADDING = 3;
const USER_ID_PATTERN = /^u([0-9]+)$/i;

/** Next sequential id (u001, u002, ...) based on the JSON users file. */
export function generateUserId(users: UserRecord[] = loadUsersJson()): string {
  const next = users.reduce((max, user) => {
    const match = typeof user.id === 'string' ? user.id.match(USER_ID_PATTERN) : null;
    const counter = match ? parseInt(match[1], 10) : 0;
    return counter > max ? counter : max;
  }, 0) + 1;
  return `${USER_ID_PREFIX}${String(next).padStart(USER_ID_PADDING, '0')}`;
}

async function readUsersJson(): Promise<UserRecord[]> {
  return loadUsersJson();
}

async function writeUsersJson(users: UserRecord[]): Promise<void> {
  saveUsers(users);
}

export async function loadUsers(): Promise<UserRecord[]> {
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    return wrapCollection(db.collection<UserRecord>('users'), 'users').find({}).toArray();
  }
  return readUsersJson();
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    return wrapCollection(db.collection<UserRecord>('users'), 'users').findOne({ id: userId });
  }
  const users = await readUsersJson();
  return users.find(u => u.id === userId) || null;
}

export async function checkUserPassword(userId: string, password: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<PublicUser> {
  assertUserScope(userId);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await wrapCollection(db.collection<UserRecord>('users'), 'users').findOneAndUpdate(
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

export async function getUserBankAccounts(userId: string): Promise<BankAccount[]> {
  assertUserScope(userId);
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  return normaliseBankAccounts(user.bankAccounts);
}

export async function getUserBankAccountNames(userId: string): Promise<string[]> {
  return toBankAccountNames(await getUserBankAccounts(userId));
}

export async function updateUserBankAccounts(userId: string, bankAccounts: BankAccount[]): Promise<PublicUser & { bankAccounts?: BankAccount[] }> {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await wrapCollection(db.collection<UserRecord>('users'), 'users').findOneAndUpdate(
      { id: userId },
      { $set: { bankAccounts } },
      { returnDocument: 'after' }
    );
    if (!user) throw new Error('User not found');
    return { id: user.id, displayName: user.displayName, avatar: user.avatar, bankAccounts };
  }
  const users = await readUsersJson();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  users[idx] = { ...users[idx], bankAccounts };
  await writeUsersJson(users);
  return { id: users[idx].id, displayName: users[idx].displayName, avatar: users[idx].avatar, bankAccounts };
}

/**
 * อ่านเกณฑ์สุขภาพงบประมาณของผู้ใช้ — defaulted-on-read เสมอ ไม่มีการเขียนตอนอ่าน (BR-DASH-009/E1)
 * normaliseBudgetThresholds เติมคีย์ที่ขาด/clamp ให้ปลอดภัยเสมอ มาจาก monthlySummary.js (M-3)
 */
export async function getUserBudgetThresholds(userId: string): Promise<BudgetThresholds> {
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
export async function updateUserBudgetThresholds(userId: string, thresholds: BudgetThresholds): Promise<PublicUser & { budgetThresholds?: unknown }> {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await wrapCollection(db.collection<UserRecord>('users'), 'users').findOneAndUpdate(
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

export async function getUserMonthlySummaryEnabled(userId: string): Promise<boolean> {
  assertUserScope(userId);
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  return user.monthlySummaryEnabled !== false;
}

export async function updateUserMonthlySummaryEnabled(userId: string, enabled: boolean): Promise<Pick<PublicUser, 'id'> & { monthlySummaryEnabled?: boolean }> {
  assertUserScope(userId);
  if (typeof enabled !== 'boolean') throw new Error('monthlySummaryEnabled must be boolean');
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await wrapCollection(db.collection<UserRecord>('users'), 'users').findOneAndUpdate(
      { id: userId },
      { $set: { monthlySummaryEnabled: enabled } },
      { returnDocument: 'after' }
    );
    if (!user) throw new Error('User not found');
    return { id: user.id, monthlySummaryEnabled: user.monthlySummaryEnabled };
  }
  const users = await readUsersJson();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) throw new Error('User not found');
  users[idx] = { ...users[idx], monthlySummaryEnabled: enabled };
  await writeUsersJson(users);
  return { id: users[idx].id, monthlySummaryEnabled: users[idx].monthlySummaryEnabled };
}

export async function getUserLastMonthlySummarySent(userId: string): Promise<string | null> {
  assertUserScope(userId);
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  return user.lastMonthlySummarySent || null;
}

export async function markUserMonthlySummarySent(userId: string, monthKey: string): Promise<string | undefined> {
  assertUserScope(userId);
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error('invalid monthly summary month');
  }
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await wrapCollection(db.collection<UserRecord>('users'), 'users').findOneAndUpdate(
      { id: userId },
      { $set: { lastMonthlySummarySent: monthKey } },
      { returnDocument: 'after' }
    );
    if (!user) throw new Error('User not found');
    return user.lastMonthlySummarySent;
  }
  return runJsonBookkeeping(async () => {
    const users = await readUsersJson();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) throw new Error('User not found');
    users[idx] = { ...users[idx], lastMonthlySummarySent: monthKey };
    await writeUsersJson(users);
    return users[idx].lastMonthlySummarySent;
  });
}

export async function updateUserLineId(userId: string, lineUserId: string): Promise<PublicUser & { LineId?: string } | null> {
  assertUserScope(userId);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    const user = await wrapCollection(db.collection<UserRecord>('users'), 'users').findOneAndUpdate(
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