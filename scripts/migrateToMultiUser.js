const fs = require('fs');
const path = require('path');

const DEFAULT_USER_ID = 'u001';
const DATA_DIR = path.join(__dirname, '..', 'src', 'backend', 'data');

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
  fs.writeFileSync(targetPath, JSON.stringify(migrated, null, 2));
  console.log(`Migrated ${file}`);
}

CONFIG.forEach(migrateFile);
