/**
 * Spawn a mythic boss at a random empty location with announcements.
 * Run with: npx ts-node src/scripts/spawn-mythic-boss.ts [x] [y] [hp] [server]
 * If x,y omitted, picks a random empty cell.
 * If hp omitted, uses the fallback random range from bossHpRanges.
 * If server omitted, spawns on ALL servers. Use server number (e.g. "2") to target one.
 */

import { MongoClient } from 'mongodb';
import { bossHpRanges, bossNames, BossTier } from 'utils';
import { RELIC_NAMES } from 'utils';

const MONGODB_URI = 'mongodb://localhost:27017';
const BOSSES_COLLECTION = 'bosses';
const GRID_COLLECTION = 'grids';
const RELICS_COLLECTION = 'relics';
const USERS_COLLECTION = 'users';
const ANNOUNCEMENTS_COLLECTION = 'announcements';
const MESSAGES_COLLECTION = 'messages';
const WORLD_SIZE = 100;

async function getServerDbNames(client: MongoClient): Promise<string[]> {
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases();
  const names = databases.map((d) => d.name);
  return names.filter((n) => n === 'users' || n.startsWith('pasiflora_server_'));
}

async function findEmptyCell(db: any, excludeX?: number, excludeY?: number): Promise<{ x: number; y: number } | null> {
  const grids = db.collection(GRID_COLLECTION);
  const bosses = db.collection(BOSSES_COLLECTION);

  const takenGrids = await grids.find({ taken: true }).project({ x: 1, y: 1 }).toArray();
  const takenSet = new Set(takenGrids.map((g: any) => `${g.x},${g.y}`));

  const activeBosses = await bosses.find({ isDefeated: false }).project({ x: 1, y: 1 }).toArray();
  for (const b of activeBosses) {
    takenSet.add(`${b.x},${b.y}`);
  }

  const candidates: { x: number; y: number }[] = [];
  for (let x = 0; x < WORLD_SIZE; x++) {
    for (let y = 0; y < WORLD_SIZE; y++) {
      if (takenSet.has(`${x},${y}`)) continue;
      if (excludeX !== undefined && excludeY !== undefined && x === excludeX && y === excludeY) continue;
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function run() {
  const args = process.argv.slice(2);
  const xArg = args[0] ? parseInt(args[0], 10) : undefined;
  const yArg = args[1] ? parseInt(args[1], 10) : undefined;
  const hpArg = args[2] ? parseInt(args[2], 10) : undefined;
  const serverArg = args[3] || undefined;

  const client = await MongoClient.connect(MONGODB_URI);
  let dbNames = await getServerDbNames(client);

  if (serverArg) {
    const target = `pasiflora_server_${serverArg}`;
    dbNames = dbNames.filter((n) => n === target);
    if (dbNames.length === 0) {
      console.error(`Server DB "${target}" not found. Available: ${(await getServerDbNames(client)).join(', ')}`);
      await client.close();
      process.exit(1);
    }
  }

  for (const dbName of dbNames) {
    const db = client.db(dbName);
    const bossesCollection = db.collection(BOSSES_COLLECTION);
    const relicsCollection = db.collection(RELICS_COLLECTION);

    const existingMythic = await bossesCollection.countDocuments({ tier: 'mythic', isDefeated: false });
    if (existingMythic > 0) {
      console.log(`[${dbName}] Mythic boss already exists, skipping.`);
      continue;
    }

    let x: number, y: number;
    if (xArg !== undefined && !isNaN(xArg) && yArg !== undefined && !isNaN(yArg)) {
      const hasBoss = await bossesCollection.findOne({ x: xArg, y: yArg, isDefeated: false });
      const hasVillage = await db.collection(GRID_COLLECTION).findOne({ x: xArg, y: yArg, taken: true });
      if (hasBoss || hasVillage) {
        console.log(`[${dbName}] Cell (${xArg},${yArg}) is occupied, finding random empty cell.`);
        const cell = await findEmptyCell(db);
        if (!cell) {
          console.log(`[${dbName}] No empty cells found.`);
          continue;
        }
        x = cell.x;
        y = cell.y;
      } else {
        x = xArg;
        y = yArg;
      }
    } else {
      const cell = await findEmptyCell(db);
      if (!cell) {
        console.log(`[${dbName}] No empty cells found.`);
        continue;
      }
      x = cell.x;
      y = cell.y;
    }

    let hp: number;
    if (hpArg !== undefined && !isNaN(hpArg) && hpArg > 0) {
      hp = hpArg;
    } else {
      const hpRange = bossHpRanges[BossTier.MYTHIC];
      hp = Math.floor(Math.random() * (hpRange.max - hpRange.min + 1)) + hpRange.min;
    }
    const name = bossNames[BossTier.MYTHIC];

    const allRelics = await relicsCollection.find({}).toArray();
    const available = allRelics.filter((r: any) => !r.holderUsername);
    const pool = available.length > 0 ? available : allRelics;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const relicId = chosen?.relicId ?? RELIC_NAMES[0]?.id ?? 'apple_of_immortality';

    const doc = {
      tier: BossTier.MYTHIC,
      name,
      x,
      y,
      maxHp: hp,
      currentHp: hp,
      spawnedAt: new Date(),
      isDefeated: false,
      relicId,
    };

    const result = await bossesCollection.insertOne(doc);
    const bossId = result.insertedId.toString();
    console.log(`[${dbName}] Mythic boss spawned at (${x}, ${y}) with ${hp.toLocaleString()} HP, relic "${relicId}"`);

    // Announcement banner
    await db.collection(ANNOUNCEMENTS_COLLECTION).insertOne({
      type: 'mythic_spawn',
      content: `⚡ A Mythic Boss has appeared at (${x}, ${y})!`,
      metadata: { x, y },
      date: new Date(),
    });

    // Global inbox message to all active players
    const allUsers = await db.collection(USERS_COLLECTION)
      .find({ isDeleted: { $ne: true } }, { projection: { username: 1 } })
      .toArray() as unknown as { username: string }[];

    const inboxDocs = allUsers.map((u) => ({
      recipientUsername: u.username,
      type: 'system_message',
      subject: `⚡ A Mythic Boss has appeared!`,
      content: `A terrifying {boss:${name}|${x}|${y}|${bossId}} has emerged!\nAll clans, ready yourselves for battle — you will need to give everything you have got to bring it down.\n\nHint:\nEach Ancient Titan guards a unique Divine Relic.\nThe clan that deals the most damage claims the relic once the titan falls.\nRelics can be stolen by defeating the village where the relic is being kept — so keep it safe and guard it well.\nOnly entrust a relic to the clan member you trust most; a disloyal holder could leave and take it with them.\n\nThe first clan to collect all 5 Divine Relics will achieve ultimate victory.`,
      date: new Date(),
      read: false,
      actionable: false,
    }));

    if (inboxDocs.length > 0) {
      await db.collection(MESSAGES_COLLECTION).insertMany(inboxDocs);
      console.log(`[${dbName}] Sent announcement + inbox message to ${inboxDocs.length} players`);
    }
  }

  await client.close();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
