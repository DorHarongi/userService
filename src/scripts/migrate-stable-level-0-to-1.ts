/**
 * Migration Script: Migrate stable level 0 to 1
 *
 * This migration updates all villages where stableLevel is 0 (or undefined) to stableLevel 1.
 * Level 0 was incorrect; stable level 1 is the correct starting level.
 *
 * Run with: npx ts-node src/scripts/migrate-stable-level-0-to-1.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb://localhost:27017';
const DB_NAME = 'users';
const USERS_COLLECTION = 'users';

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db(DB_NAME);
    const usersCollection = db.collection(USERS_COLLECTION);

    console.log('Running migration: stable level 0 → 1');

    const result = await usersCollection.updateMany(
        {},
        [
            {
                $set: {
                    villages: {
                        $map: {
                            input: '$villages',
                            as: 'v',
                            in: {
                                $mergeObjects: [
                                    '$$v',
                                    {
                                        buildingsLevels: {
                                            $mergeObjects: [
                                                { $ifNull: ['$$v.buildingsLevels', {}] },
                                                {
                                                    stableLevel: {
                                                        $cond: {
                                                            if: {
                                                                $eq: [
                                                                    { $ifNull: ['$$v.buildingsLevels.stableLevel', 0] },
                                                                    0,
                                                                ],
                                                            },
                                                            then: 1,
                                                            else: '$$v.buildingsLevels.stableLevel',
                                                        },
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
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
