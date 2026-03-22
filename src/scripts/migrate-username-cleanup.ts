/**
 * Migration: Clean up usernames and clan names
 * - Trim whitespace from all usernames and clan names
 * - Truncate usernames > 15 characters
 * - Flag/handle space-only usernames
 * - Update all references: users, grids, clans, movements
 *
 * Runs across ALL servers.
 * Run with: npx ts-node src/scripts/migrate-username-cleanup.ts
 */

import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const ACCOUNTS_DB = 'pasiflora_accounts';
const SERVER_DB_PREFIX = 'pasiflora_server_';
const MAX_USERNAME_LENGTH = 15;
const MAX_CLAN_NAME_LENGTH = 15;

const DRY_RUN = process.argv.includes('--dry-run');

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

async function findUniqueUsername(db: Db, desired: string, currentId: any): Promise<string> {
    let candidate = desired;
    let suffix = 1;
    while (true) {
        const existing = await db.collection('users').findOne({
            username: candidate,
            _id: { $ne: currentId },
        });
        if (!existing) return candidate;
        candidate = desired.slice(0, MAX_USERNAME_LENGTH - String(suffix).length) + suffix;
        suffix++;
    }
}

async function migrateServer(client: MongoClient, serverId: number): Promise<void> {
    const dbName = `${SERVER_DB_PREFIX}${serverId}`;
    const db = client.db(dbName);
    console.log(`\n=== Server ${serverId} (${dbName}) ===`);

    // --- Username cleanup ---
    const users = await db.collection('users').find({}).toArray();
    let usernameFixed = 0;
    let clanNameFixed = 0;

    for (const user of users) {
        const original = user.username as string;
        let cleaned = (original || '').trim();

        if (!cleaned) {
            console.log(`  WARNING: User _id=${user._id} has empty/space-only username "${original}" — skipping (needs manual fix)`);
            continue;
        }

        if (cleaned.length > MAX_USERNAME_LENGTH) {
            cleaned = cleaned.slice(0, MAX_USERNAME_LENGTH);
        }

        if (cleaned === original) continue;

        const unique = await findUniqueUsername(db, cleaned, user._id);
        console.log(`  Username: "${original}" → "${unique}"${DRY_RUN ? ' [DRY RUN]' : ''}`);

        if (!DRY_RUN) {
            await db.collection('users').updateOne(
                { _id: user._id },
                { $set: { username: unique } },
            );

            await db.collection('grids').updateMany(
                { ownerUsername: original },
                { $set: { ownerUsername: unique } },
            );

            await db.collection('movements').updateMany(
                { senderUsername: original },
                { $set: { senderUsername: unique } },
            );
            await db.collection('movements').updateMany(
                { targetUsername: original },
                { $set: { targetUsername: unique } },
            );

            await db.collection('clans').updateMany(
                { leaderUsername: original },
                { $set: { leaderUsername: unique } },
            );
            await db.collection('clans').updateMany(
                { members: original },
                { $set: { 'members.$': unique } },
            );
            await db.collection('clans').updateMany(
                { 'joinRequests.username': original },
                { $set: { 'joinRequests.$.username': unique } },
            );
        }

        usernameFixed++;
    }

    // --- Clan name cleanup ---
    const clans = await db.collection('clans').find({}).toArray();

    for (const clan of clans) {
        const original = clan.clanName as string;
        let cleaned = (original || '').trim();

        if (!cleaned) {
            console.log(`  WARNING: Clan _id=${clan._id} has empty/space-only name "${original}" — skipping`);
            continue;
        }

        if (cleaned.length > MAX_CLAN_NAME_LENGTH) {
            cleaned = cleaned.slice(0, MAX_CLAN_NAME_LENGTH);
        }

        if (cleaned === original) continue;

        console.log(`  Clan name: "${original}" → "${cleaned}"${DRY_RUN ? ' [DRY RUN]' : ''}`);

        if (!DRY_RUN) {
            await db.collection('clans').updateOne(
                { _id: clan._id },
                { $set: { clanName: cleaned } },
            );

            await db.collection('users').updateMany(
                { clanName: original },
                { $set: { clanName: cleaned } },
            );
        }

        clanNameFixed++;
    }

    console.log(`  Server ${serverId} done: ${usernameFixed} usernames fixed, ${clanNameFixed} clan names fixed`);
}

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    console.log(`Running username/clan name cleanup migration...${DRY_RUN ? ' [DRY RUN MODE - no writes]' : ''}`);

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
