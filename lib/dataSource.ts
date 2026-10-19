import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { Collection, Document } from 'mongodb';
import { getDbPromise } from './mongodb';
import dataModeConfig from './dataMode.config';
import { wrapCollection } from './auditContext';

const DATA_MODE = (dataModeConfig?.mode || 'json').toLowerCase();
const DATA_DIR = path.resolve(process.cwd(), 'src/backend/data');

const COLLECTION_FILES: Record<string, string> = {
  monthly_income: 'monthly_income.json',
  monthly_expense: 'monthly_expense.json',
  salary: 'salary.json',
  savings: 'savings.json',
  investment: 'investment.json',
  tax_accumulated: 'tax_accumulated.json'
};

const JSON_SPACING = 2;

export const getDataMode = (): string => DATA_MODE;
export const isJsonMode = (): boolean => DATA_MODE === 'json';

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function getFilePath(collection: string): string {
  const file = COLLECTION_FILES[collection];
  if (!file) {
    throw new Error(`Unknown collection: ${collection}`);
  }
  return path.join(DATA_DIR, file);
}

export async function readJsonCollection(collection: string): Promise<unknown[]> {
  const filePath = getFilePath(collection);
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // รองรับไฟล์ที่อาจหลุดโครงสร้าง
    return [];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(filePath, '[]', 'utf-8');
      return [];
    }
    throw error;
  }
}

export async function writeJsonCollection(collection: string, docs: unknown): Promise<void> {
  const filePath = getFilePath(collection);
  await ensureDataDir();
  const data = Array.isArray(docs) ? docs : [];
  await fs.writeFile(filePath, JSON.stringify(data, null, JSON_SPACING), 'utf-8');
}

export async function getMongoCollection<T extends Document = Document>(collection: string): Promise<Collection<T>> {
  const db = await getDbPromise();
  return wrapCollection(db.collection<T>(collection), collection);
}

export function withGeneratedId<T extends Document = Document>(doc: T = {} as T): T {
  if (doc._id) return doc;
  return { _id: crypto.randomBytes(12).toString('hex'), ...doc } as T;
}

interface EnforceJsonLimitOptions<T> {
  docs?: T[];
  limit?: number;
  selector?: (doc: T) => unknown;
  comparator?: (a: string, b: string) => number;
}

export function enforceJsonLimit<T extends { month?: unknown }>({
  docs = [],
  limit = 15,
  selector = (doc: T) => doc.month,
  comparator,
}: EnforceJsonLimitOptions<T> = {}): T[] {
  if (!Array.isArray(docs)) {
    return [];
  }
  const getKey = selector || ((doc: T) => doc.month);
  const keyed: { key: string; doc: T }[] = [];
  const withoutKey: T[] = [];
  docs.forEach(doc => {
    const key = getKey(doc);
    if (typeof key === 'string' && key.length > 0) {
      keyed.push({ key, doc });
    } else {
      withoutKey.push(doc);
    }
  });
  const compareFn = comparator || ((a: string, b: string) => b.localeCompare(a));
  keyed.sort((a, b) => compareFn(a.key, b.key));
  const limited: T[] = [];
  const seen = new Set<string>();
  for (const entry of keyed) {
    if (seen.has(entry.key)) {
      continue;
    }
    if (limited.length >= limit) {
      break;
    }
    limited.push(entry.doc);
    seen.add(entry.key);
  }
  return [...limited, ...withoutKey];
}