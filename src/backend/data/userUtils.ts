import path from 'path';
import bcrypt from 'bcryptjs';
import { dataDir, jsonRead, jsonWrite } from '../../../lib/auditJsonStore';

const usersPath = (): string => path.join(dataDir(), 'users.json');
const USER_ID_PREFIX = 'u';
const USER_ID_PADDING = 3;
const USER_ID_PATTERN = /^u(\d+)$/i;

interface UserRecord {
  id: string;
  displayName?: string;
  avatar?: string | null;
  passwordHash?: string;
  LineId?: string;
  bankAccounts?: unknown[];
  [key: string]: unknown;
}

interface PublicUser {
  id: string;
  displayName?: string;
  avatar?: string | null;
  LineId?: string;
  bankAccounts?: unknown[];
}

// Persisted collections have different schemas and are validated by their API/domain callers.
type UserData = Record<string, any>;

interface LimitUserEntriesOptions {
  limit?: number;
  keySelector?: (mapKey: string, value: unknown) => unknown;
}

export function loadUsers(): UserRecord[] {
  try {
    const raw = jsonRead(usersPath());
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as UserRecord[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function saveUsers(users: UserRecord[] = []): void {
  jsonWrite(usersPath(), JSON.stringify(users, null, 2));
}

export function getUserById(userId: string): UserRecord | null {
  const users = loadUsers();
  return users.find(user => user.id === userId) || null;
}

function parseUserCounter(userId: unknown): number | null {
  if (typeof userId !== 'string') return null;
  const match = userId.match(USER_ID_PATTERN);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatUserId(counter: number): string {
  const safeCounter = Math.max(1, parseInt(String(counter), 10) || 1);
  return `${USER_ID_PREFIX}${String(safeCounter).padStart(USER_ID_PADDING, '0')}`;
}

export function generateUserId(): string {
  const users = loadUsers();
  const nextCounter = users.reduce((max, user) => {
    const counter = parseUserCounter(user.id);
    return counter && counter > max ? counter : max;
  }, 0) + 1;
  return formatUserId(nextCounter);
}

export async function checkUserPassword(userId: string, password: string): Promise<boolean> {
  const user = getUserById(userId);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash as string);
}

export async function updateUserPassword(userId: string, nextPassword: string): Promise<PublicUser> {
  if (!userId || typeof nextPassword !== 'string') throw new Error('Invalid payload');
  const users = loadUsers();
  const userIndex = users.findIndex(user => user.id === userId);
  if (userIndex === -1) throw new Error('User not found');
  const passwordHash = await bcrypt.hash(nextPassword, 10);
  users[userIndex] = { ...users[userIndex], passwordHash };
  saveUsers(users);
  return {
    id: users[userIndex].id,
    displayName: users[userIndex].displayName,
    avatar: users[userIndex].avatar
  };
}

export function updateUserLineId(userId: string, lineUserId: string): PublicUser | null {
  if (!userId || !lineUserId) throw new Error('Invalid payload');
  const users = loadUsers();
  const userIndex = users.findIndex(user => user.id === userId);
  if (userIndex === -1) return null;
  users[userIndex] = { ...users[userIndex], LineId: lineUserId };
  saveUsers(users);
  return {
    id: users[userIndex].id,
    displayName: users[userIndex].displayName,
    avatar: users[userIndex].avatar,
    LineId: users[userIndex].LineId as string
  };
}

export function getUserBankAccounts(userId: string): unknown[] {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  return user.bankAccounts || [];
}

export function updateUserBankAccounts(userId: string, bankAccounts: unknown[]): PublicUser {
  if (!userId) throw new Error('Invalid userId');
  if (!Array.isArray(bankAccounts)) throw new Error('bankAccounts must be an array');
  const users = loadUsers();
  const userIndex = users.findIndex(user => user.id === userId);
  if (userIndex === -1) throw new Error('User not found');
  users[userIndex] = { ...users[userIndex], bankAccounts };
  saveUsers(users);
  return {
    id: users[userIndex].id,
    displayName: users[userIndex].displayName,
    avatar: users[userIndex].avatar,
    bankAccounts: users[userIndex].bankAccounts
  };
}

export function resolveDataPath(filename: string): string {
  return path.join(dataDir(), filename);
}

export function readDataFile(filename: string): UserData {
  const filePath = resolveDataPath(filename);
  try {
    const raw = jsonRead(filePath);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as UserData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {};
}

export function writeDataFile(filename: string, payload: unknown): void {
  const filePath = resolveDataPath(filename);
  jsonWrite(filePath, JSON.stringify(payload || {}, null, 2));
}

function ensureUserBucket(data: UserData, userId: string): UserData {
  if (!data[userId]) data[userId] = {};
  return data[userId];
}

export function getUserData(filename: string, userId: string): UserData {
  const data = readDataFile(filename);
  return data[userId] || {};
}

export function setUserData(filename: string, userId: string, userPayload: unknown): unknown {
  const data = readDataFile(filename);
  data[userId] = userPayload;
  writeDataFile(filename, data);
  return data[userId];
}

export function updateUserData(
  filename: string,
  userId: string,
  updater: UserData | ((bucket: UserData) => unknown)
): unknown {
  const data = readDataFile(filename);
  const bucket = ensureUserBucket(data, userId);
  const nextBucket = typeof updater === 'function' ? updater({ ...bucket }) : updater;
  data[userId] = nextBucket;
  writeDataFile(filename, data);
  return data[userId];
}

export function limitUserEntries(bucket: unknown = {}, { limit = 15, keySelector }: LimitUserEntriesOptions = {}): UserData {
  if (!bucket || typeof bucket !== 'object') return {};
  const keyed: { mapKey: string; value: unknown; selectorKey: string }[] = [];
  const passthrough: UserData = {};
  Object.entries(bucket).forEach(([mapKey, value]) => {
    const selectorKey = typeof keySelector === 'function' ? keySelector(mapKey, value) : mapKey;
    if (typeof selectorKey === 'string' && selectorKey.length > 0) keyed.push({ mapKey, value, selectorKey });
    else passthrough[mapKey] = value;
  });
  keyed.sort((a, b) => b.selectorKey.localeCompare(a.selectorKey));
  const trimmed = keyed.slice(0, limit);
  const limited = { ...passthrough };
  trimmed.forEach(entry => { limited[entry.mapKey] = entry.value; });
  return limited;
}

/** Enforce the 15-month data limit per user using the entry's month field. */
export function enforceUserMonthLimit(bucket: UserData = {}, limit = 15): UserData {
  if (!bucket || typeof bucket !== 'object') return {};
  return limitUserEntries(bucket, {
    limit,
    keySelector: (_key, value) => (value as { month?: string } | null)?.month || ''
  });
}