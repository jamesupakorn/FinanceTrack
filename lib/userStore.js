import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getDbPromise } from './mongodb';
import dataModeConfig from './dataMode.config';

const DATA_MODE = (dataModeConfig?.mode || 'json').toLowerCase();
const USERS_FILE = path.resolve(process.cwd(), 'src/backend/data/users.json');

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
  const passwordHash = await bcrypt.hash(newPassword, 10);
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    await db.collection('users').updateOne({ id: userId }, { $set: { passwordHash } });
    const user = await db.collection('users').findOne({ id: userId });
    if (!user) throw new Error('User not found');
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
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  return user.bankAccounts || [];
}

export async function updateUserBankAccounts(userId, bankAccounts) {
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    await db.collection('users').updateOne({ id: userId }, { $set: { bankAccounts } });
    const user = await db.collection('users').findOne({ id: userId });
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

export async function updateUserLineId(userId, lineUserId) {
  if (DATA_MODE === 'mongo') {
    const db = await getDbPromise();
    await db.collection('users').updateOne({ id: userId }, { $set: { LineId: lineUserId } });
    const user = await db.collection('users').findOne({ id: userId });
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
