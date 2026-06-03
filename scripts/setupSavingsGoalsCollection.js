#!/usr/bin/env node
/**
 * MongoDB Setup Script: Savings Goals Collection
 * File: scripts/setupSavingsGoalsCollection.js
 * 
 * Creates the savingsGoals collection with schema validation and indexes
 * Usage: node scripts/setupSavingsGoalsCollection.js
 */

const { getDbPromise } = require('../lib/mongodb');
const { ObjectId } = require('mongodb');

const COLLECTION_NAME = 'savingsGoals';

/**
 * Schema validator for savings goals
 */
const schemaValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['userId', 'goalName', 'targetAmount'],
    properties: {
      _id: { bsonType: 'objectId' },
      userId: {
        bsonType: 'string',
        description: 'User ID in format u###',
        pattern: '^u[0-9]{3}$'
      },
      goalName: {
        bsonType: 'string',
        description: 'Name of the savings goal',
        minLength: 1,
        maxLength: 100
      },
      description: {
        bsonType: ['string', 'null'],
        description: 'Optional description of the goal'
      },
      targetAmount: {
        bsonType: ['double', 'int'],
        description: 'Target amount to save',
        minimum: 0
      },
      currentAmount: {
        bsonType: ['double', 'int'],
        description: 'Current amount saved',
        minimum: 0,
        default: 0
      },
      currency: {
        bsonType: 'string',
        description: 'Currency code',
        enum: ['THB', 'USD', 'EUR'],
        default: 'THB'
      },
      category: {
        bsonType: 'string',
        description: 'Goal category',
        enum: ['emergency', 'investment', 'wedding', 'vacation', 'education', 'other'],
        default: 'other'
      },
      priority: {
        bsonType: 'string',
        description: 'Goal priority level',
        enum: ['low', 'medium', 'high'],
        default: 'medium'
      },
      status: {
        bsonType: 'string',
        description: 'Goal status',
        enum: ['active', 'paused', 'completed', 'abandoned'],
        default: 'active'
      },
      startDate: {
        bsonType: 'date',
        description: 'When the goal was created'
      },
      endDate: {
        bsonType: ['date', 'null'],
        description: 'Target completion date'
      },
      tags: {
        bsonType: 'array',
        description: 'Tags for categorizing goals',
        items: { bsonType: 'string' }
      },
      notes: {
        bsonType: ['string', 'null'],
        description: 'Additional notes'
      },
      createdAt: {
        bsonType: 'date',
        description: 'When the goal was created'
      },
      updatedAt: {
        bsonType: 'date',
        description: 'When the goal was last updated'
      },
      metadata: {
        bsonType: 'object',
        description: 'Computed metadata for display',
        properties: {
          progressPercentage: {
            bsonType: ['double', 'int'],
            description: 'Progress as percentage (0-100)',
            minimum: 0,
            maximum: 100
          },
          remainingAmount: {
            bsonType: ['double', 'int'],
            description: 'Amount remaining to reach target',
            minimum: 0
          },
          monthlyContribution: {
            bsonType: ['double', 'int', 'null'],
            description: 'Target monthly savings amount'
          },
          estimatedCompletionDate: {
            bsonType: ['date', 'null'],
            description: 'Estimated date to reach target'
          }
        }
      }
    }
  }
};

/**
 * Index definitions
 */
const indexes = [
  {
    key: { userId: 1 },
    name: 'idx_userId',
    description: 'Query all goals for a user'
  },
  {
    key: { userId: 1, status: 1 },
    name: 'idx_userId_status',
    description: 'Query active goals for a user'
  },
  {
    key: { userId: 1, category: 1 },
    name: 'idx_userId_category',
    description: 'Query goals by category for a user'
  },
  {
    key: { userId: 1, endDate: 1 },
    name: 'idx_userId_endDate',
    description: 'Sort goals by deadline'
  },
  {
    key: { createdAt: -1 },
    name: 'idx_createdAt_desc',
    description: 'Timeline queries across all users'
  }
];

/**
 * Sample data for u001
 */
const sampleGoals = [
  {
    userId: 'u001',
    goalName: 'Wedding Fund',
    description: 'Save for honeymoon in Bali',
    targetAmount: 250000,
    currentAmount: 120000,
    currency: 'THB',
    category: 'wedding',
    priority: 'high',
    status: 'active',
    startDate: new Date('2024-01-15'),
    endDate: new Date('2025-06-30'),
    tags: ['finance', 'personal', 'urgent'],
    notes: 'Need to save 4,000 per month',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-06-10'),
    metadata: {
      progressPercentage: 48.0,
      remainingAmount: 130000,
      monthlyContribution: 4000,
      estimatedCompletionDate: new Date('2025-06-02')
    }
  },
  {
    userId: 'u001',
    goalName: 'Emergency Fund',
    description: '6 months of living expenses',
    targetAmount: 120000,
    currentAmount: 85000,
    currency: 'THB',
    category: 'emergency',
    priority: 'high',
    status: 'active',
    startDate: new Date('2023-06-01'),
    endDate: new Date('2025-12-31'),
    tags: ['essential', 'finance'],
    notes: null,
    createdAt: new Date('2023-06-01'),
    updatedAt: new Date('2024-06-10'),
    metadata: {
      progressPercentage: 70.83,
      remainingAmount: 35000,
      monthlyContribution: 2000,
      estimatedCompletionDate: new Date('2024-11-15')
    }
  },
  {
    userId: 'u001',
    goalName: 'Vacation Fund - Japan',
    description: null,
    targetAmount: 80000,
    currentAmount: 45000,
    currency: 'THB',
    category: 'vacation',
    priority: 'medium',
    status: 'active',
    startDate: new Date('2024-03-20'),
    endDate: new Date('2024-12-31'),
    tags: ['travel', 'personal'],
    notes: 'Cherry blossom season trip',
    createdAt: new Date('2024-03-20'),
    updatedAt: new Date('2024-06-10'),
    metadata: {
      progressPercentage: 56.25,
      remainingAmount: 35000,
      monthlyContribution: 5000,
      estimatedCompletionDate: new Date('2024-11-05')
    }
  }
];

/**
 * Main setup function
 */
async function setupSavingsGoalsCollection() {
  try {
    console.log('🔧 Setting up savingsGoals collection...\n');

    const db = await getDbPromise();

    // Check if collection exists
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    if (collectionNames.includes(COLLECTION_NAME)) {
      console.log(`⚠️  Collection "${COLLECTION_NAME}" already exists.`);
      const answer = await askQuestion('Drop and recreate? (y/n): ');

      if (answer.toLowerCase() === 'y') {
        await db.collection(COLLECTION_NAME).drop();
        console.log(`✓ Dropped existing collection\n`);
      } else {
        console.log('❌ Setup cancelled\n');
        process.exit(0);
      }
    }

    // Create collection with validator
    console.log('📋 Creating collection with schema validator...');
    await db.createCollection(COLLECTION_NAME, {
      validator: schemaValidator,
      validationAction: 'error',
      validationLevel: 'strict'
    });
    console.log(`✓ Collection created with strict validation\n`);

    // Create indexes
    console.log('🔍 Creating indexes...');
    const collection = db.collection(COLLECTION_NAME);

    for (const indexDef of indexes) {
      const { key, name, description } = indexDef;
      const keyStr = Object.entries(key)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');

      try {
        await collection.createIndex(key, { name });
        console.log(`  ✓ ${name} (${keyStr}) - ${description}`);
      } catch (err) {
        console.error(`  ✗ Failed to create ${name}: ${err.message}`);
      }
    }
    console.log('');

    // Insert sample data
    console.log('📝 Inserting sample data for u001...');
    const result = await collection.insertMany(sampleGoals);
    console.log(`✓ Inserted ${result.insertedIds.length} sample goals\n`);

    // Show statistics
    console.log('📊 Collection Statistics:');
    console.log(`  - Collection: ${COLLECTION_NAME}`);
    console.log(`  - Documents: ${result.insertedIds.length}`);
    console.log(`  - Indexes: ${indexes.length}`);
    console.log(`  - Sample Goals:`);

    sampleGoals.forEach(goal => {
      const progress = goal.metadata.progressPercentage.toFixed(1);
      console.log(
        `    • ${goal.goalName} (${goal.category}) - ${progress}% (${goal.currentAmount}/${goal.targetAmount})`
      );
    });

    console.log('\n✅ Setup complete! Collection is ready for use.\n');

    // Show next steps
    console.log('📌 Next Steps:');
    console.log('  1. Update .env.local: DATA_MODE=mongo');
    console.log('  2. Restart development server: npm run dev');
    console.log('  3. Navigate to Savings tab to see goals');
    console.log('  4. Create new goals using the UI\n');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

/**
 * Helper to ask questions on command line
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Run setup
setupSavingsGoalsCollection().catch(console.error);
