/**
 * Fix empty/whitespace-only village names by renaming them to "New Village".
 * Also updates the corresponding grid cell's villageName.
 *
 * Run with: npx ts-node src/scripts/fix-empty-village-names.ts [--dry-run]
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const ACCOUNTS_DB = 'pasiflora_accounts';
const SERVER_DB_PREFIX = 'pasiflora_server_';
const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_NAME = 'New Village';

async function getServerIds(client: MongoClient): Promise<number[]> {
    try {
        const accountsDb = client.db(ACCOUNTS_DB);
        const servers = await accountsDb.collection('servers').find({ status: 'active' }).toArray();
        if (servers.length > 0) {
            return servers.map((s: any) => s.serverId).filter((id: any) => id != null);
        }
    } catch (_) {}
    return [1];
}

async function migrateServer(client: MongoClient, serverId: number): Promise<void> {
    const dbName = `${SERVER_DB_PREFIX}${serverId}`;
    const db = client.db(dbName);
    console.log(`\n=== Server ${serverId} (${dbName}) ===`);

    const usersWithEmptyVillageNames = await db.collection('users').find({
        'villages.villageName': { $exists: true },
    }, { projection: { username: 1, villages: 1 } }).toArray();

    if (usersWithEmptyVillageNames.length === 0) {
        console.log('  No users found.');
        return;
    }

    const INVISIBLE_CHARS = /[\s\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF\u00A0\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u2000-\u200F\u202A-\u202E\u2028\u2029\u205F\u2066-\u2069\u3000\u3164\uFFA0]/g;

    let totalFixed = 0;
    for (const user of usersWithEmptyVillageNames) {
        const username = user.username;
        const villages = user.villages || [];

        for (let i = 0; i < villages.length; i++) {
            const village = villages[i];
            const name = (village.villageName || '').replace(INVISIBLE_CHARS, '').trim();
            if (name.length > 0) continue;

            console.log(`  User "${username}", village index ${i}: "${village.villageName}" → "${DEFAULT_NAME}"${DRY_RUN ? ' [DRY RUN]' : ''}`);

            if (!DRY_RUN) {
                await db.collection('users').updateOne(
                    { _id: user._id },
                    { $set: { [`villages.${i}.villageName`]: DEFAULT_NAME } },
                );

                if (village.location) {
                    const gridResult = await db.collection('grids').updateOne(
                        { x: village.location.x, y: village.location.y, ownerUsername: username },
                        { $set: { villageName: DEFAULT_NAME } },
                    );
                    console.log(`    Grid cell updated: ${gridResult.modifiedCount}`);
                }
            }
            totalFixed++;
        }
    }

    console.log(`  Fixed ${totalFixed} empty village name(s).`);
}

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    console.log(`Fixing empty village names → "${DEFAULT_NAME}"...${DRY_RUN ? ' [DRY RUN]' : ''}`);

    const serverIds = await getServerIds(client);
    console.log(`Found servers: ${serverIds.join(', ')}`);

    for (const serverId of serverIds) {
        await migrateServer(client, serverId);
    }

    console.log('\nDone!');
    await client.close();
}

run().catch((err) => {
    console.error('Script failed', err);
    process.exit(1);
});
