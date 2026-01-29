#!/usr/bin/env node
/*
 * Quick utility script for appending a new profile to src/backend/data/users.json.
 * Usage:
 *   node scripts/createUser.js "Display Name" "plainPassword" [/avatars/u003.jpg] [customUserId]
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const {
  loadUsers,
  generateUserId,
  resolveDataPath,
} = require('../src/backend/data/userUtils');

const args = process.argv.slice(2);

function printUsage() {
  console.log('Usage: node scripts/createUser.js "Display Name" "plainPassword" [/avatars/u003.jpg] [customUserId]');
}

if (args.length < 2) {
  console.error('Error: Display name and password are required.');
  printUsage();
  process.exit(1);
}

const displayName = args[0].trim();
const password = args[1];
const avatar = args[2] ? args[2].trim() : '';
const customUserId = args[3] ? args[3].trim() : null;

if (!displayName) {
  console.error('Error: Display name cannot be empty.');
  process.exit(1);
}

const users = loadUsers();
const normalizedName = displayName.toLowerCase();
const nameExists = users.some(user => user.displayName.toLowerCase() === normalizedName);
if (nameExists) {
  console.error(`Error: Display name "${displayName}" already exists.`);
  process.exit(1);
}

let userId = customUserId || generateUserId();
if (customUserId) {
  const idExists = users.some(user => user.id === customUserId);
  if (idExists) {
    console.error(`Error: User ID "${customUserId}" already exists.`);
    process.exit(1);
  }
}

const passwordHash = bcrypt.hashSync(password, 10);
const newUser = {
  id: userId,
  displayName,
  avatar,
  passwordHash,
};

const updatedUsers = [...users, newUser];
const usersFilePath = resolveDataPath('users.json');
fs.writeFileSync(usersFilePath, JSON.stringify(updatedUsers, null, 2));

console.log(`Created user ${displayName} (${userId}).`);
if (avatar) {
  console.log(`Avatar: ${avatar}`);
}
console.log('Done.');
