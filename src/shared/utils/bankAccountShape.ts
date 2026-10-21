export interface BankAccount {
  id: string;
  name: string;
}

export const UNASSIGNED_ACCOUNT_LABEL = 'อื่นๆ/ไม่ระบุบัญชี';

export function getBankAccountName(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name.trim() : '';
}

export function toBankAccountNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  values.forEach(value => {
    const name = getBankAccountName(value);
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });
  return names;
}
