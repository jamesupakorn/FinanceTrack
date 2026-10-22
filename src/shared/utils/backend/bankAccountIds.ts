import crypto from 'crypto';
import type { BankAccount } from '../bankAccountShape';
import { getBankAccountName } from '../bankAccountShape';

const BANK_ACCOUNT_ID_PATTERN = /^(?:ba_[0-9a-f]{12}|bal_[0-9a-f]{16})$/;

export function isBankAccountId(value: unknown): value is string {
  return typeof value === 'string' && BANK_ACCOUNT_ID_PATTERN.test(value);
}

export function generateBankAccountId(): string {
  return `ba_${crypto.randomBytes(6).toString('hex')}`;
}

export function deriveLegacyBankAccountId(name: string): string {
  return `bal_${crypto.createHash('sha256').update(name.trim()).digest('hex').slice(0, 16)}`;
}

export function normaliseBankAccountEntry(value: unknown): BankAccount | null {
  const name = getBankAccountName(value);
  if (!name) return null;
  const id = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as { id?: unknown }).id
    : undefined;
  return {
    id: isBankAccountId(id) ? id : deriveLegacyBankAccountId(name),
    name
  };
}

export function normaliseBankAccounts(value: unknown): BankAccount[] {
  if (!Array.isArray(value)) return [];
  const accounts: BankAccount[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  value.forEach(entry => {
    const account = normaliseBankAccountEntry(entry);
    if (!account || names.has(account.name) || ids.has(account.id)) return;
    names.add(account.name);
    ids.add(account.id);
    accounts.push(account);
  });
  return accounts;
}

export function validateIncomingBankAccounts(value: unknown[]): string | null {
  const names = new Set<string>();
  const ids = new Set<string>();

  for (const [index, entry] of value.entries()) {
    const isString = typeof entry === 'string' && entry.trim().length > 0;
    const isNamedObject = entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
      typeof (entry as { name?: unknown }).name === 'string' &&
      (entry as { name: string }).name.trim().length > 0;
    if (!isString && !isNamedObject) {
      return `bankAccounts[${index}] must be a non-empty string or an object with a non-empty name`;
    }
    const name = getBankAccountName(entry);
    if (names.has(name)) return 'bankAccounts contains duplicate names';
    names.add(name);

    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const id = (entry as { id?: unknown }).id;
      if (isBankAccountId(id)) {
        if (ids.has(id)) return 'bankAccounts contains duplicate ids';
        ids.add(id);
      }
    }
  }
  return null;
}

export function assignBankAccountIds(
  incoming: unknown[],
  stored: BankAccount[]
): BankAccount[] {
  const requestedIds = new Set<string>();
  incoming.forEach(entry => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const id = (entry as { id?: unknown }).id;
      if (isBankAccountId(id)) requestedIds.add(id);
    }
  });

  const assignedIds = new Set<string>();
  const storedIds = new Set(stored.map(account => account.id));
  const forbiddenMintIds = new Set([
    ...stored.map(account => account.id),
    ...requestedIds
  ]);

  return incoming.map(entry => {
    const name = getBankAccountName(entry);
    const requestedId = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as { id?: unknown }).id
      : undefined;

    // A client-supplied id is only kept when it's both format-valid AND still present in
    // `stored` — otherwise it may be a stale/deleted id resurrected by a stale browser tab,
    // which must not silently re-link a dangling credit card to a new account (see
    // .pipeline/spec-findings-bank-account-manager-fix.md Fix 1).
    let id: string | undefined = isBankAccountId(requestedId) && storedIds.has(requestedId)
      ? requestedId
      : undefined;
    if (!id) {
      const reusable = stored.find(account =>
        account.name === name &&
        !assignedIds.has(account.id) &&
        !requestedIds.has(account.id)
      );
      id = reusable?.id;
    }
    if (!id) {
      do {
        id = generateBankAccountId();
      } while (forbiddenMintIds.has(id) || assignedIds.has(id));
    }

    assignedIds.add(id);
    forbiddenMintIds.add(id);
    return { id, name };
  });
}
