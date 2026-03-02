import { MongoClient } from 'mongodb';
import { Skills, EMPTY_SKILLS } from 'utils';

const url = 'mongodb://localhost:27017/';
const dbName = 'users';

async function run() {
    const client = await MongoClient.connect(url + dbName);
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    console.log('Running Chunk 1 migration: traits -> skills, stable + spies fields');

    await usersCollection.updateMany(
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
                                        skills: {
                                            $ifNull: ['$$v.skills', EMPTY_SKILLS],
                                        },
                                        'buildingsLevels.stableLevel': {
                                            $ifNull: ['$$v.buildingsLevels.stableLevel', 0],
                                        },
                                        aliveSpies: {
                                            $ifNull: ['$$v.aliveSpies', 0],
                                        },
                                        spyDeathTimestamps: {
                                            $ifNull: ['$$v.spyDeathTimestamps', []],
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
            {
                $unset: ['villages.trait'],
            },
        ],
    );

    console.log('Chunk 1 migration completed.');
    await client.close();
}

run().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
});

