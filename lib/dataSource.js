import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import dbPromise from './mongodb';
import dataModeConfig from './dataMode.config';

const DATA_MODE = (dataModeConfig?.mode || 'json').toLowerCase();
const DATA_DIR = path.resolve(process.cwd(), 'src/backend/data');

const COLLECTION_FILES = {
  monthly_income: 'monthly_income.json',
  monthly_expense: 'monthly_expense.json',
  salary: 'salary.json',
  savings: 'savings.json',
  investment: 'investment.json',
  tax_accumulated: 'tax_accumulated.json'
};

const JSON_SPACING = 2;

export const getDataMode = () => DATA_MODE;
export const isJsonMode = () => DATA_MODE === 'json';

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function getFilePath(collection) {
  const file = COLLECTION_FILES[collection];
  if (!file) {
    throw new Error(`Unknown collection: ${collection}`);
  }
  return path.join(DATA_DIR, file);
}

export async function readJsonCollection(collection) {
  const filePath = getFilePath(collection);
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // รองรับไฟล์ที่อาจหลุดโครงสร้าง
    return [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(filePath, '[]', 'utf-8');
      return [];
    }
    throw error;
  }
}

export async function writeJsonCollection(collection, docs) {
  const filePath = getFilePath(collection);
  await ensureDataDir();
  const data = Array.isArray(docs) ? docs : [];
  await fs.writeFile(filePath, JSON.stringify(data, null, JSON_SPACING), 'utf-8');
}

export async function getMongoCollection(collection) {
  const db = await dbPromise;
  return db.collection(collection);
}

export function withGeneratedId(doc = {}) {
  if (doc._id) return doc;
  return { _id: crypto.randomBytes(12).toString('hex'), ...doc };
}

export function enforceJsonLimit({
  docs = [],
  limit = 15,
  selector = (doc) => doc.month,
  comparator,
}) {
  if (!Array.isArray(docs)) {
    return [];
  }
  const getKey = selector || ((doc) => doc.month);
  const keyed = [];
  const withoutKey = [];
  docs.forEach(doc => {
    const key = getKey(doc);
    if (typeof key === 'string' && key.length > 0) {
      keyed.push({ key, doc });
    } else {
      withoutKey.push(doc);
    }
  });
  const compareFn = comparator || ((a, b) => b.localeCompare(a));
  keyed.sort((a, b) => compareFn(a.key, b.key));
  const limited = [];
  const seen = new Set();
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
