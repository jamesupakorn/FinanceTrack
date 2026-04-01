const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function getMongoUri() {
  const envPath = path.join(process.cwd(), '.env.local');
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^MONGODB_URI\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('MONGODB_URI not found in .env.local');
  }
  return match[1];
}

async function run() {
  const uri = getMongoUri();
  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db('financetrack');
  const collection = db.collection('monthly_expense');

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
      await collection.updateOne({ _id: doc._id }, { $unset: unset });
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
    updated,
    remainTopEstimate,
    remainTotalEstimate,
    remainNestedEstimate
  }, null, 2));

  await client.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
