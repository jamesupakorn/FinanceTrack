// สคริปต์นี้จะดึงข้อมูลตัวอย่างจากทุก collection ที่เกี่ยวข้องใน MongoDB Atlas
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Vercel-Admin-financetrack:sGXm0Wl35MhD4ANu@financetrack.txujoc6.mongodb.net/financetrack';
const DB_NAME = 'financetrack';
const COLLECTIONS = [
  'monthly_income',
  'monthly_expense',
  'salary',
  'savings',
  'tax_accumulated',
  'investment',
];

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  for (const col of COLLECTIONS) {
    const docs = await db.collection(col).find({}).limit(3).toArray();
    console.log(`\nCollection: ${col}`);
    if (docs.length === 0) {
      console.log('  (no documents)');
    } else {
      docs.forEach((doc, i) => {
        console.log(`  [${i+1}]`, JSON.stringify(doc, null, 2));
      });
    }
  }
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
