/**
 * Multi-server migration — run LAST after all other migrations.
 * 1. Rename `users` database to `pasiflora_server_1` (via copying collections + drop, or admin rename)
 * 2. Create `pasiflora_accounts` with user auth data and servers collection
 * 3. Create servers collection with Server 1 entry
 *
 * WARNING: MongoDB does not support renaming a database directly.
 * Standard approach: create pasiflora_server_1, copy all collections from users into it,
 * then drop users (or leave users as legacy). Alternatively keep using 'users' as server 1 DB
 * and only create pasiflora_accounts for auth + server list.
 *
 * This script implements: create pasiflora_accounts DB with a `servers` collection.
 * Copy `users` collection content into pasiflora_server_1 (new DB) so that game data lives there.
 * For minimal change we keep existing DB name 'users' as server 1 and only add accounts DB + servers list.
 */

import { MongoClient } from 'mongodb';

const url = 'mongodb://localhost:27017/';
const existingDbName = 'users';
const accountsDbName = 'pasiflora_accounts';
const server1DbName = 'pasiflora_server_1';

async function run() {
    const client = await MongoClient.connect(url);

    console.log('Running multi-server migration (safe mode: create accounts + servers list only).');

    const existingDb = client.db(existingDbName);
    const accountsDb = client.db(accountsDbName);

    // Create servers collection in accounts DB
    const serversCollection = accountsDb.collection('servers');
    const serverCount = await serversCollection.countDocuments();
    if (serverCount === 0) {
        await serversCollection.insertOne({
            serverId: 1,
            name: 'Server 1',
            status: 'active',
            playerCount: 0, // optional, can be updated by app
        });
        console.log('Created servers collection with Server 1 entry.');
    }

    // Optional: copy users DB to pasiflora_server_1 for true isolation (then point app to server 1 DB name)
    const server1Db = client.db(server1DbName);
    const existingCollections = await existingDb.listCollections().toArray();
    const collNames = existingCollections.map((c) => c.name);
    for (const name of collNames) {
        const existingColl = existingDb.collection(name);
        const server1Coll = server1Db.collection(name);
        const count = await server1Coll.countDocuments();
        if (count === 0) {
            const docs = await existingColl.find({}).toArray();
            if (docs.length > 0) {
                await server1Coll.insertMany(docs);
                console.log(`Copied collection ${name} to ${server1DbName}.`);
            }
        }
    }

    console.log('Multi-server migration completed. Ensure app uses serverId and DB names as per PLAN.');
    await client.close();
}

run().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
});
