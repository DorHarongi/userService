/**
 * Migration Script: Rename "sigil_of_creation" → "sigil_of_thunder"
 *
 * Updates relicId in all relevant collections across all server databases.
 *
 * Run with: npx ts-node src/scripts/rename-sigil-of-creation.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const OLD_ID = 'sigil_of_creation';
const NEW_ID = 'sigil_of_thunder';

const COLLECTIONS_WITH_RELIC_ID = ['relics', 'movements', 'bosses'];

async function getServerDbNames(client: MongoClient): Promise<string[]> {
    const admin = client.db().admin();
    const { databases } = await admin.listDatabases();
    const names = databases.map((d) => d.name);
    return names.filter(
        (n) => n.startsWith('pasiflora_server_')
    );
}

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    const dbNames = await getServerDbNames(client);
    let totalUpdated = 0;

    for (const dbName of dbNames) {
        const db = client.db(dbName);

        for (const collName of COLLECTIONS_WITH_RELIC_ID) {
            const coll = db.collection(collName);
            const result = await coll.updateMany(
                { relicId: OLD_ID },
                { $set: { relicId: NEW_ID } },
            );
            if (result.modifiedCount > 0) {
                console.log(`[${dbName}.${collName}] Renamed ${result.modifiedCount} document(s)`);
                totalUpdated += result.modifiedCount;
            }
        }
    }

    console.log(`\nMigration completed. Renamed ${totalUpdated} document(s) across all servers.`);
    await client.close();
}

run().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
});
