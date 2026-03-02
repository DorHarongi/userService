import { MongoClient } from 'mongodb';
import { RELIC_NAMES } from 'utils';

const url = 'mongodb://localhost:27017/';
const dbName = 'users';

async function run() {
    const client = await MongoClient.connect(url);
    const db = client.db(dbName);

    console.log('Running Chunk 3 migration: relics init, theme, serverConfig');

    const usersCollection = db.collection('users');
    await usersCollection.updateMany(
        { theme: { $exists: false } },
        { $set: { theme: 'default' } },
    );
    console.log('Added theme to users.');

    const relicsCollection = db.collection('relics');
    const relicCount = await relicsCollection.countDocuments();
    if (relicCount === 0) {
        const docs = RELIC_NAMES.map((r) => ({
            relicId: r.id,
            holderUsername: null,
            holderVillageName: null,
            holderClanName: null,
            transferCooldownUntil: null,
            obtainedAt: null,
        }));
        await relicsCollection.insertMany(docs);
        console.log('Initialized 5 relic documents.');
    } else {
        console.log('Relics collection already has documents, skipping.');
    }

    const serverConfigCollection = db.collection('serverConfig');
    const configCount = await serverConfigCollection.countDocuments();
    if (configCount === 0) {
        await serverConfigCollection.insertOne({
            serverId: 1,
            status: 'active',
        });
        console.log('Created serverConfig document.');
    } else {
        console.log('serverConfig already exists, skipping.');
    }

    console.log('Chunk 3 migration completed.');
    await client.close();
}

run().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
});
