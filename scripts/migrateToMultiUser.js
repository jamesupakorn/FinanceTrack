// One-off: convert per-file flat-array JSON data stores into per-user keyed objects.
// Usage: node scripts/migrateToMultiUser.js            (dry-run — prints what would be rewritten)
//        node scripts/migrateToMultiUser.js --apply    (writes the migrated files to disk)
const fs = require('fs');
const path = require('path');

const DEFAULT_USER_ID = 'u001';
const DATA_DIR = path.join(__dirname, '..', 'src', 'backend', 'data');

const apply = process.argv.includes('--apply');

const CONFIG = [
  { file: 'monthly_income.json', key: 'month' },
  { file: 'monthly_expense.json', key: 'month' },
  { file: 'salary.json', key: 'month' },
  { file: 'savings.json', key: 'month' },
  { file: 'investment.json', key: 'month' },
  { file: 'tax_accumulated.json', key: 'year' },
];

function toMultiUserPayload(records, keyProp) {
  if (!Array.isArray(records)) {
    console.log(`Skipping file already in object form`);
    return records;
  }

  const collection = {};

  records.forEach(entry => {
    if (!entry || typeof entry !== 'object') return;
    const mapKey = entry[keyProp];
    if (!mapKey) return;
    collection[mapKey] = entry;
  });

  return { [DEFAULT_USER_ID]: collection };
}

function migrateFile({ file, key }) {
  const targetPath = path.join(DATA_DIR, file);
  const raw = fs.readFileSync(targetPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    console.log(`Already migrated: ${file}`);
    return;
  }

  const migrated = toMultiUserPayload(parsed, key);

  if (!apply) {
    console.log(`Would migrate: ${file} (dry run only — no write performed)`);
    return;
  }

  fs.writeFileSync(targetPath, JSON.stringify(migrated, null, 2));
  console.log(`Migrated ${file}`);
}

console.log(`Target data directory: ${DATA_DIR}`);
console.log(`Files to process: ${CONFIG.map(c => c.file).join(', ')}`);
if (!apply) {
  console.log('Dry run only — no write performed. Re-run with --apply to persist these changes.');
}

CONFIG.forEach(migrateFile);
