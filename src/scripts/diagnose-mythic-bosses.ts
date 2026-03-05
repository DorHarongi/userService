/**
 * Diagnostic: List all mythic bosses and their relicId status
 * Run with: npx ts-node src/scripts/diagnose-mythic-bosses.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb://localhost:27017';

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    const admin = client.db().admin();
    const { databases } = await admin.listDatabases();
    const dbNames = databases
        .map((d) => d.name)
        .filter((n) => n === 'users' || n.startsWith('pasiflora_server_'));

    console.log('Mythic bosses across all server databases:\n');

    for (const dbName of dbNames) {
        const db = client.db(dbName);
        const bosses = await db.collection('bosses').find({
            tier: 'mythic',
            isDefeated: false,
        }).toArray();

        if (bosses.length === 0) {
            console.log(`[${dbName}] No active mythic bosses.`);
            continue;
        }

        console.log(`[${dbName}] ${bosses.length} active mythic boss(es):`);
        for (const b of bosses) {
            const hasRelic = !!(b.relicId && b.relicId !== '');
            console.log(`  - id: ${b._id} | x:${b.x} y:${b.y} | relicId: ${b.relicId ?? '(missing)'} | hasRelic: ${hasRelic}`);
        }
        console.log('');
    }

    await client.close();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
