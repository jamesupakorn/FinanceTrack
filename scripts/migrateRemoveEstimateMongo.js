// One-off: remove legacy `estimate`/`totalEstimate` fields from monthly_expense documents.
// Usage: node scripts/migrateRemoveEstimateMongo.js            (dry-run — scans and reports counts)
//        node scripts/migrateRemoveEstimateMongo.js --apply    (writes the $unset updates)
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const apply = process.argv.includes('--apply');

function getMongoUri() {
  const envPath = path.join(process.cwd(), '.env.local');
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^MONGODB_URI\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('MONGODB_URI not found in .env.local');
  }
  return match[1];
}

// Never print the full URI — it carries the username/password. Host only.
function getUriHost(uri) {
  try {
    return new URL(uri).host;
  } catch {
    // Fallback for URI forms the WHATWG URL parser rejects: strip credentials manually.
    const withoutCreds = uri.replace(/\/\/[^@]*@/, '//');
    const match = withoutCreds.match(/^[a-zA-Z+]+:\/\/([^/?]+)/);
    return match ? match[1] : '(unknown host)';
  }
}

async function run() {
  const uri = getMongoUri();
  const client = new MongoClient(uri);
  await client.connect();

  const DATABASE_NAME = 'financetrack';
  const db = client.db(DATABASE_NAME);
  const collection = db.collection('monthly_expense');

  console.log(`Target: db="${DATABASE_NAME}" host=${getUriHost(uri)}`);
  if (!apply) {
    console.log('Dry run only — no write performed. Re-run with --apply to persist these changes.');
  }

  const ignoreKeys = new Set(['_id', 'month', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid']);
  let scanned = 0;
  let updated = 0;

  const cursor = collection.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    const unset = {};

    if (Object.prototype.hasOwnProperty.call(doc, 'totalEstimate')) {
      unset.totalEstimate = '';
    }

    if (Object.prototype.hasOwnProperty.call(doc, 'estimate')) {
      unset.estimate = '';
    }

    for (const [key, value] of Object.entries(doc)) {
      if (ignoreKeys.has(key)) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (Object.prototype.hasOwnProperty.call(value, 'estimate')) {
        unset[`${key}.estimate`] = '';
      }
    }

    if (Object.keys(unset).length > 0) {
      if (apply) {
        await collection.updateOne({ _id: doc._id }, { $unset: unset });
      }
      updated += 1;
    }
  }

  const remainTopEstimate = await collection.countDocuments({ estimate: { $exists: true } });
  const remainTotalEstimate = await collection.countDocuments({ totalEstimate: { $exists: true } });

  const nestedRemain = await collection.aggregate([
    {
      $project: {
        pairs: { $objectToArray: '$$ROOT' }
      }
    },
    {
      $project: {
        hasNestedEstimate: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: '$pairs',
                  as: 'pair',
                  cond: {
                    $and: [
                      { $eq: [{ $type: '$$pair.v' }, 'object'] },
                      { $not: { $in: ['$$pair.k', ['_id', 'month', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid']] } },
                      {
                        $in: [
                          'estimate',
                          {
                            $map: {
                              input: { $objectToArray: '$$pair.v' },
                              as: 'nested',
                              in: '$$nested.k'
                            }
                          }
                        ]
                      }
                    ]
                  }
                }
              }
            },
            0
          ]
        }
      }
    },
    { $match: { hasNestedEstimate: true } },
    { $count: 'count' }
  ]).toArray();

  const remainNestedEstimate = nestedRemain[0]?.count || 0;

  console.log(JSON.stringify({
    scanned,
    [apply ? 'updated' : 'wouldUpdate']: updated,
    remainTopEstimate,
    remainTotalEstimate,
    remainNestedEstimate
  }, null, 2));
  if (!apply) {
    console.log('Re-run with --apply to persist these changes.');
  }

  await client.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
