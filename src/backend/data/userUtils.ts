import path from 'path';
import { dataDir, jsonRead, jsonWrite } from '../../../lib/auditJsonStore';

// Persisted collections have different schemas and are validated by their API/domain callers.
type UserData = Record<string, any>;

interface LimitUserEntriesOptions {
  limit?: number;
  keySelector?: (mapKey: string, value: unknown) => unknown;
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