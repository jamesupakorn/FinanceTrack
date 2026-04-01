#!/usr/bin/env node
/**
 * Migration script: Add bankAccounts field to users without it
 * Usage: node scripts/migrateBankAccounts.js
 * 
 * This script adds the `bankAccounts` field to any existing users
 * that don't have it yet, initializing them with default accounts.
 */

const { loadUsers, saveUsers } = require('../src/backend/data/userUtils');
const DEFAULT_BANK_ACCOUNTS = ['กรุงศรี', 'ttb', 'กสิกร', 'UOB'];

try {
  const users = loadUsers();
  
  if (!users || !Array.isArray(users)) {
    console.log('No users found or invalid format');
    process.exit(0);
  }
  
  let updated = 0;
  const migratedUsers = users.map(user => {
    // If user doesn't have bankAccounts, add it
    if (!Array.isArray(user.bankAccounts)) {
      console.log(`Adding bankAccounts to user: ${user.id} (${user.displayName})`);
      updated++;
      return {
        ...user,
        bankAccounts: DEFAULT_BANK_ACCOUNTS
      };
    }
    return user;
  });
  
  if (updated > 0) {
    saveUsers(migratedUsers);
    console.log(`\n✓ Migration completed: ${updated} users updated`);
  } else {
    console.log('✓ All users already have bankAccounts field');
  }
  
  process.exit(0);
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
