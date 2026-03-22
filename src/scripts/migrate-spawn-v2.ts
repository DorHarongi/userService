/**
 * Migration: Redistribute all players, oases, and bosses using the V2 spawning algorithm.
 * Applies to ALL active servers.
 *
 * Strategy:
 * 1. Sort users by joinDate (oldest first)
 * 2. Clear all grid cell ownership
 * 3. Place villages one-by-one using V2 (75% proximity / 25% sparse)
 * 4. Relocate oases near villages
 * 5. Relocate bosses near villages
 *
 * Run with: npx ts-node src/scripts/migrate-spawn-v2.ts
 */

import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const ACCOUNTS_DB = 'pasiflora_accounts';
const SERVER_DB_PREFIX = 'pasiflora_server_';

const DRY_RUN = process.argv.includes('--dry-run');

const WORLD_SIZE = 100;
const PROXIMITY_RANGE = 20;
const SPARSE_CHANCE = 0.35;
const CANDIDATES = 15;
const SAFE_RADIUS = 8;
const OASIS_PROXIMITY_RANGE = 20;
const BOSS_PROXIMITY_RANGE = 20;

type Pos = { x: number; y: number };

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function randInt(lo: number, hi: number): number {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

class GridMap {
    private cells: boolean[];
    constructor() {
        this.cells = new Array(WORLD_SIZE * WORLD_SIZE).fill(false);
    }
    isTaken(x: number, y: number): boolean {
        return this.cells[y * WORLD_SIZE + x];
    }
    take(x: number, y: number): void {
        this.cells[y * WORLD_SIZE + x] = true;
    }
    isFree(x: number, y: number): boolean {
        return x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE && !this.cells[y * WORLD_SIZE + x];
    }
}

function sampleFreeNear(grid: GridMap, cx: number, cy: number, range: number, attempts = 50): Pos | null {
    for (let i = 0; i < attempts; i++) {
        const x = clamp(cx + randInt(-range, range), 0, WORLD_SIZE - 1);
        const y = clamp(cy + randInt(-range, range), 0, WORLD_SIZE - 1);
        if (grid.isFree(x, y)) return { x, y };
    }
    return null;
}

function sampleAnyFree(grid: GridMap): Pos | null {
    for (let i = 0; i < 500; i++) {
        const x = randInt(0, WORLD_SIZE - 1);
        const y = randInt(0, WORLD_SIZE - 1);
        if (grid.isFree(x, y)) return { x, y };
    }
    return null;
}

function countNeighbors(villages: Pos[], x: number, y: number, radius: number): number {
    let c = 0;
    for (const v of villages) {
        if (Math.abs(v.x - x) <= radius && Math.abs(v.y - y) <= radius) c++;
    }
    return c;
}

function spawnV2(grid: GridMap, villages: Pos[]): Pos | null {
    if (villages.length === 0) {
        return sampleFreeNear(grid, 50, 50, 5);
    }

    // Sparse: sample from ENTIRE map, pick lowest-density spot
    if (Math.random() < SPARSE_CHANCE) {
        let best: Pos | null = null;
        let bestDensity = Infinity;
        for (let i = 0; i < CANDIDATES; i++) {
            const spot = sampleAnyFree(grid);
            if (!spot) continue;
            const n = countNeighbors(villages, spot.x, spot.y, SAFE_RADIUS);
            if (n < bestDensity) { bestDensity = n; best = spot; }
        }
        if (best) return best;
    }

    // Proximity: place near a random existing village
    const anchor = villages[randInt(0, villages.length - 1)];
    const spot = sampleFreeNear(grid, anchor.x, anchor.y, PROXIMITY_RANGE);
    if (spot) return spot;

    return sampleAnyFree(grid);
}

function spawnNearVillages(grid: GridMap, villages: Pos[], range: number): Pos | null {
    if (villages.length === 0) return sampleAnyFree(grid);
    const anchor = villages[randInt(0, villages.length - 1)];
    const spot = sampleFreeNear(grid, anchor.x, anchor.y, range);
    return spot || sampleAnyFree(grid);
}

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
    const db: Db = client.db(dbName);
    console.log(`\n=== Server ${serverId} (${dbName}) ===`);

    const usersCollection = db.collection('users');
    const gridsCollection = db.collection('grids');
    const oasesCollection = db.collection('oases');
    const bossesCollection = db.collection('bosses');

    // Load all users sorted by join date (oldest first get placed first)
    const users = await usersCollection.find({}).sort({ joinDate: 1 }).toArray();
    console.log(`  Found ${users.length} users`);

    // Load oases and bosses
    const oases = await oasesCollection.find({}).toArray();
    const bosses = await bossesCollection.find({ isDefeated: false }).toArray();
    console.log(`  Found ${oases.length} oases, ${bosses.length} active bosses`);

    // Step 1: Reset all grid cells
    if (!DRY_RUN) {
        await gridsCollection.updateMany({}, { $set: { taken: false, ownerUsername: null, villageName: null } });
    }
    console.log(`  Reset all grid cells${DRY_RUN ? ' [DRY RUN]' : ''}`);

    // Step 2: Place villages using V2
    const grid = new GridMap();
    const placedVillages: Pos[] = [];
    let villagesPlaced = 0;

    for (const user of users) {
        if (!user.villages || user.villages.length === 0) continue;

        const updatedVillages = [];
        for (const village of user.villages) {
            const loc = spawnV2(grid, placedVillages);
            if (!loc) {
                console.log(`  WARNING: No space for village "${village.villageName}" of ${user.username}`);
                updatedVillages.push(village);
                continue;
            }

            grid.take(loc.x, loc.y);
            placedVillages.push(loc);

            const updatedVillage = { ...village, location: { x: loc.x, y: loc.y } };
            updatedVillages.push(updatedVillage);

            if (!DRY_RUN) {
                await gridsCollection.updateOne(
                    { x: loc.x, y: loc.y },
                    { $set: { taken: true, ownerUsername: user.username, villageName: village.villageName } },
                );
            }
            villagesPlaced++;
        }

        if (!DRY_RUN) {
            await usersCollection.updateOne(
                { _id: user._id },
                { $set: { villages: updatedVillages } },
            );
        }
    }
    console.log(`  Placed ${villagesPlaced} villages${DRY_RUN ? ' [DRY RUN]' : ''}`);

    // Step 3: Relocate oases
    let oasesPlaced = 0;
    for (const oasis of oases) {
        const loc = spawnNearVillages(grid, placedVillages, OASIS_PROXIMITY_RANGE);
        if (!loc) {
            console.log(`  WARNING: No space for oasis _id=${oasis._id}`);
            continue;
        }
        grid.take(loc.x, loc.y);
        if (!DRY_RUN) {
            await oasesCollection.updateOne(
                { _id: oasis._id },
                { $set: { x: loc.x, y: loc.y } },
            );
        }
        oasesPlaced++;
    }
    console.log(`  Relocated ${oasesPlaced} oases${DRY_RUN ? ' [DRY RUN]' : ''}`);

    // Step 4: Relocate bosses
    let bossesPlaced = 0;
    for (const boss of bosses) {
        const loc = spawnNearVillages(grid, placedVillages, BOSS_PROXIMITY_RANGE);
        if (!loc) {
            console.log(`  WARNING: No space for boss _id=${boss._id}`);
            continue;
        }
        grid.take(loc.x, loc.y);
        if (!DRY_RUN) {
            await bossesCollection.updateOne(
                { _id: boss._id },
                { $set: { x: loc.x, y: loc.y } },
            );
        }
        bossesPlaced++;
    }
    console.log(`  Relocated ${bossesPlaced} bosses${DRY_RUN ? ' [DRY RUN]' : ''}`);

    console.log(`  Server ${serverId} migration complete`);
}

async function run() {
    const client = await MongoClient.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    console.log(`Running V2 spawn redistribution migration...${DRY_RUN ? ' [DRY RUN MODE - no writes]' : ''}`);

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
