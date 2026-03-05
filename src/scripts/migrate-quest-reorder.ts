/**
 * Migration Script: Update currentQuestIndex after quest reorder
 *
 * "Join the Community" was moved from position 15 to position 17 (last quest).
 * This migration maps old indices to new:
 *   - 15 (was Join the Community) → 17
 *   - 16 (was Upgrade the Stable) → 15
 *   - 17 (was Unlock the Academy) → 16
 *
 * Run with: npx ts-node src/scripts/migrate-quest-reorder.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb://localhost:27017';
const DB_NAME = 'users';
const USERS_COLLECTION = 'users';

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db(DB_NAME);
    const usersCollection = db.collection(USERS_COLLECTION);

    console.log('Running migration: quest reorder (Join the Community → last)');

    const result = await usersCollection.updateMany(
        { currentQuestIndex: { $in: [15, 16, 17] } },
        [
            {
                $set: {
                    currentQuestIndex: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$currentQuestIndex', 15] }, then: 17 },
                                { case: { $eq: ['$currentQuestIndex', 16] }, then: 15 },
                                { case: { $eq: ['$currentQuestIndex', 17] }, then: 16 },
                            ],
                            default: '$currentQuestIndex',
                        },
                    },
                },
            },
        ],
    );

    console.log(`Migration completed. Modified ${result.modifiedCount} users.`);
    await client.close();
}

run().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
});
