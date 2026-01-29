const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(process.cwd(), 'src', 'backend', 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const USER_ID_PREFIX = 'u';
const USER_ID_PADDING = 3;
const USER_ID_PATTERN = /^u(\d+)$/i;

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function getUserById(userId) {
  const users = loadUsers();
  return users.find(u => u.id === userId) || null;
}

function parseUserCounter(userId) {
  if (typeof userId !== 'string') return null;
  const match = userId.match(USER_ID_PATTERN);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatUserId(counter) {
  const safeCounter = Math.max(1, parseInt(counter, 10) || 1);
  return `${USER_ID_PREFIX}${String(safeCounter).padStart(USER_ID_PADDING, '0')}`;
}

function generateUserId() {
  const users = loadUsers();
  const nextCounter = users.reduce((max, user) => {
    const counter = parseUserCounter(user.id);
    return counter && counter > max ? counter : max;
  }, 0) + 1;
  return formatUserId(nextCounter);
}

async function checkUserPassword(userId, password) {
  const user = getUserById(userId);
  if (!user) return false;
  return await bcrypt.compare(password, user.passwordHash);
}

function resolveDataPath(filename) {
  return path.join(DATA_DIR, filename);
}

function readDataFile(filename) {
  const filePath = resolveDataPath(filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
  return {};
}

function writeDataFile(filename, payload) {
  const filePath = resolveDataPath(filename);
  fs.writeFileSync(filePath, JSON.stringify(payload || {}, null, 2));
}

function ensureUserBucket(data, userId) {
  if (!data[userId]) {
    data[userId] = {};
  }
  return data[userId];
}

function getUserData(filename, userId) {
  const data = readDataFile(filename);
  return data[userId] || {};
}

function setUserData(filename, userId, userPayload) {
  const data = readDataFile(filename);
  data[userId] = userPayload;
  writeDataFile(filename, data);
  return data[userId];
}

function updateUserData(filename, userId, updater) {
  const data = readDataFile(filename);
  const bucket = ensureUserBucket(data, userId);
  const nextBucket = typeof updater === 'function' ? updater({ ...bucket }) : updater;
  data[userId] = nextBucket;
  writeDataFile(filename, data);
  return data[userId];
}

function limitUserEntries(bucket = {}, { limit = 15, keySelector } = {}) {
  if (!bucket || typeof bucket !== 'object') {
    return {};
  }
  const keyed = [];
  const passthrough = {};
  Object.entries(bucket).forEach(([mapKey, value]) => {
    const selectorKey = typeof keySelector === 'function' ? keySelector(mapKey, value) : mapKey;
    if (typeof selectorKey === 'string' && selectorKey.length > 0) {
      keyed.push({ mapKey, value, selectorKey });
    } else {
      passthrough[mapKey] = value;
    }
  });
  keyed.sort((a, b) => b.selectorKey.localeCompare(a.selectorKey));
  const trimmed = keyed.slice(0, limit);
  const limited = { ...passthrough };
  trimmed.forEach(entry => {
    limited[entry.mapKey] = entry.value;
  });
  return limited;
}

module.exports = {
  loadUsers,
  getUserById,
  checkUserPassword,
  generateUserId,
  resolveDataPath,
  readDataFile,
  writeDataFile,
  getUserData,
  setUserData,
  updateUserData,
  limitUserEntries,
};
