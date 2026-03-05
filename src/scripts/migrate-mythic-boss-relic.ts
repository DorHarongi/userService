/**
 * Migration Script: Add relicId to mythic bosses missing it
 *
 * Mythic bosses spawned before relic binding was added have no relicId,
 * causing "Reward on defeat:" to show empty. This migration adds a random
 * relic to each mythic boss that doesn't have one.
 *
 * Runs on all server databases: users (server 1) and pasiflora_server_* (server 2+)
 *
 * Run with: npx ts-node src/scripts/migrate-mythic-boss-relic.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import { RELIC_NAMES } from 'utils';

const MONGODB_URI = 'mongodb://localhost:27017';
const BOSSES_COLLECTION = 'bosses';

async function getServerDbNames(client: MongoClient): Promise<string[]> {
    const admin = client.db().admin();
    const { databases } = await admin.listDatabases();
    const names = databases.map((d) => d.name);
    // users = server 1, pasiflora_server_N = server 2+
    return names.filter(
        (n) => n === 'users' || n.startsWith('pasiflora_server_')
    );
}

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    const dbNames = await getServerDbNames(client);
    const relicIds = RELIC_NAMES.map((r) => r.id);
    let totalUpdated = 0;

    for (const dbName of dbNames) {
        const db = client.db(dbName);
        const bossesCollection = db.collection(BOSSES_COLLECTION);

        const mythicWithoutRelic = await bossesCollection
            .find({
                tier: 'mythic',
                isDefeated: false,
                $or: [
                    { relicId: { $exists: false } },
                    { relicId: null },
                    { relicId: '' },
                ],
            })
            .toArray();

        if (mythicWithoutRelic.length === 0) {
            console.log(`[${dbName}] No mythic bosses without relicId.`);
            continue;
        }

        console.log(`[${dbName}] Found ${mythicWithoutRelic.length} mythic boss(es) without relicId.`);
        for (const boss of mythicWithoutRelic) {
            const randomRelic = relicIds[Math.floor(Math.random() * relicIds.length)];
            await bossesCollection.updateOne(
                { _id: boss._id },
                { $set: { relicId: randomRelic } }
            );
            console.log(`  Boss ${(boss._id as ObjectId).toHexString()} at (${boss.x},${boss.y}): assigned "${randomRelic}"`);
            totalUpdated++;
        }
    }

    console.log(`\nMigration completed. Updated ${totalUpdated} mythic boss(es) across all servers.`);
    await client.close();
}

run().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
});
