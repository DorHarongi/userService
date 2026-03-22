/**
 * Migration: Rename space-only usernames to "new player" (with uniqueness suffix).
 * Updates all references: users, grids, movements, clans, oases.
 *
 * Run with: npx ts-node src/scripts/migrate-space-username.ts [--dry-run]
 */

import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const ACCOUNTS_DB = 'pasiflora_accounts';
const SERVER_DB_PREFIX = 'pasiflora_server_';
const DRY_RUN = process.argv.includes('--dry-run');
const NEW_NAME_BASE = 'new player';

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

async function findUniqueName(db: Db, desired: string, currentId: any): Promise<string> {
    let candidate = desired;
    let suffix = 1;
    while (true) {
        const existing = await db.collection('users').findOne({
            username: candidate,
            _id: { $ne: currentId },
        });
        if (!existing) return candidate;
        candidate = `${desired}${suffix}`;
        suffix++;
    }
}

async function migrateServer(client: MongoClient, serverId: number): Promise<void> {
    const dbName = `${SERVER_DB_PREFIX}${serverId}`;
    const db = client.db(dbName);
    console.log(`\n=== Server ${serverId} (${dbName}) ===`);

    const spaceUsers = await db.collection('users').find({
        username: { $regex: /^\s*$/ },
    }).toArray();

    if (spaceUsers.length === 0) {
        console.log('  No space-only usernames found.');
        return;
    }

    for (const user of spaceUsers) {
        const original = user.username as string;
        const newName = await findUniqueName(db, NEW_NAME_BASE, user._id);
        console.log(`  Renaming: "${original}" (${original.length} chars, _id=${user._id}) → "${newName}"${DRY_RUN ? ' [DRY RUN]' : ''}`);

        if (!DRY_RUN) {
            await db.collection('users').updateOne(
                { _id: user._id },
                { $set: { username: newName } },
            );

            const gridResult = await db.collection('grids').updateMany(
                { ownerUsername: original },
                { $set: { ownerUsername: newName } },
            );
            console.log(`    grids updated: ${gridResult.modifiedCount}`);

            let movResult = await db.collection('movements').updateMany(
                { senderUsername: original },
                { $set: { senderUsername: newName } },
            );
            console.log(`    movements (sender) updated: ${movResult.modifiedCount}`);

            movResult = await db.collection('movements').updateMany(
                { targetUsername: original },
                { $set: { targetUsername: newName } },
            );
            console.log(`    movements (target) updated: ${movResult.modifiedCount}`);

            const clanLeaderResult = await db.collection('clans').updateMany(
                { leaderUsername: original },
                { $set: { leaderUsername: newName } },
            );
            console.log(`    clans (leader) updated: ${clanLeaderResult.modifiedCount}`);

            await db.collection('clans').updateMany(
                { members: original },
                { $set: { 'members.$': newName } },
            );

            await db.collection('clans').updateMany(
                { 'joinRequests.username': original },
                { $set: { 'joinRequests.$.username': newName } },
            );

            const oasisResult = await db.collection('oases').updateMany(
                { 'garrison.username': original },
                { $set: { 'garrison.username': newName } },
            );
            console.log(`    oases (garrison) updated: ${oasisResult.modifiedCount}`);
        }

        console.log(`  Done renaming "${original}" → "${newName}"`);
    }
}

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    console.log(`Renaming space-only usernames to "${NEW_NAME_BASE}"...${DRY_RUN ? ' [DRY RUN]' : ''}`);

    const serverIds = await getServerIds(client);
    console.log(`Found servers: ${serverIds.join(', ')}`);

    for (const serverId of serverIds) {
        await migrateServer(client, serverId);
    }

    console.log('\nMigration complete!');
    await client.close();
}

run().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
});
