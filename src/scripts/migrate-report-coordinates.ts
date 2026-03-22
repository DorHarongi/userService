import { MongoClient, Db } from 'mongodb';

const MONGO_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const SERVER_DB_PREFIX = 'pasiflora_server_';
const DRY_RUN = false;

async function migrateServer(client: MongoClient, serverId: number): Promise<void> {
  const dbName = `${SERVER_DB_PREFIX}${serverId}`;
  const db = client.db(dbName);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Server ${serverId} (${dbName})`);
  console.log(`${'='.repeat(50)}`);

  // Build oasis lookup: id -> { x, y }
  const oases = await db.collection('oases').find({}).toArray();
  const oasisMap = new Map<string, { x: number; y: number }>();
  for (const o of oases) {
    oasisMap.set(o._id.toString(), { x: o.x, y: o.y });
  }
  console.log(`Loaded ${oases.length} oases`);

  // Build boss lookup: id -> { x, y }
  const bosses = await db.collection('bosses').find({}).toArray();
  const bossMap = new Map<string, { x: number; y: number }>();
  for (const b of bosses) {
    bossMap.set(b._id.toString(), { x: b.x, y: b.y });
  }
  console.log(`Loaded ${bosses.length} bosses`);

  // ── 1. Messages with {oasis:name|x|y|id} ──
  await migrateOasisMessages(db, oasisMap);

  // ── 2. Reports (oasis_spy) with oasisId, oasisX, oasisY ──
  await migrateOasisSpyReports(db, oasisMap);

  // ── 3. Reports (boss) with bossId, bossX, bossY ──
  await migrateBossReports(db, bossMap);

  // ── 4. RaidReports with bossId, bossX, bossY ──
  await migrateRaidReports(db, bossMap);
}

async function migrateOasisMessages(db: Db, oasisMap: Map<string, { x: number; y: number }>): Promise<void> {
  console.log(`\n--- Messages (oasis refs) ---`);

  const oasisRefRegex = /\{oasis:([^|]+)\|(\d+)\|(\d+)\|([a-f0-9]+)\}/g;
  const messages = await db.collection('messages').find({
    content: { $regex: /\{oasis:/ },
  }).toArray();

  let updated = 0;
  let skippedGone = 0;
  let alreadyCorrect = 0;

  for (const msg of messages) {
    let newContent = msg.content as string;
    let changed = false;

    newContent = newContent.replace(oasisRefRegex, (fullMatch, name, xStr, yStr, id) => {
      const oasis = oasisMap.get(id);
      if (!oasis) {
        skippedGone++;
        return fullMatch;
      }
      const oldX = parseInt(xStr);
      const oldY = parseInt(yStr);
      if (oasis.x === oldX && oasis.y === oldY) {
        alreadyCorrect++;
        return fullMatch;
      }
      changed = true;
      return `{oasis:${name}|${oasis.x}|${oasis.y}|${id}}`;
    });

    if (changed) {
      updated++;
      if (!DRY_RUN) {
        await db.collection('messages').updateOne(
          { _id: msg._id },
          { $set: { content: newContent } },
        );
      }
    }
  }

  console.log(`  Total messages scanned: ${messages.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Already correct: ${alreadyCorrect}`);
  console.log(`  Skipped (oasis gone): ${skippedGone}`);
}

async function migrateOasisSpyReports(db: Db, oasisMap: Map<string, { x: number; y: number }>): Promise<void> {
  console.log(`\n--- Reports (oasis_spy) ---`);

  const reports = await db.collection('reports').find({
    reportType: 'oasis_spy',
    oasisId: { $exists: true },
  }).toArray();

  let updated = 0;
  let skippedGone = 0;
  let alreadyCorrect = 0;

  for (const report of reports) {
    const oasis = oasisMap.get(report.oasisId?.toString());
    if (!oasis) {
      skippedGone++;
      continue;
    }
    if (oasis.x === report.oasisX && oasis.y === report.oasisY) {
      alreadyCorrect++;
      continue;
    }
    updated++;
    if (!DRY_RUN) {
      await db.collection('reports').updateOne(
        { _id: report._id },
        { $set: { oasisX: oasis.x, oasisY: oasis.y } },
      );
    }
  }

  console.log(`  Total reports scanned: ${reports.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Already correct: ${alreadyCorrect}`);
  console.log(`  Skipped (oasis gone): ${skippedGone}`);
}

async function migrateBossReports(db: Db, bossMap: Map<string, { x: number; y: number }>): Promise<void> {
  console.log(`\n--- Reports (boss) ---`);

  const reports = await db.collection('reports').find({
    reportType: 'boss',
    bossId: { $exists: true },
  }).toArray();

  let updated = 0;
  let skippedGone = 0;
  let alreadyCorrect = 0;

  for (const report of reports) {
    const boss = bossMap.get(report.bossId?.toString());
    if (!boss) {
      skippedGone++;
      continue;
    }
    if (boss.x === report.bossX && boss.y === report.bossY) {
      alreadyCorrect++;
      continue;
    }
    updated++;
    if (!DRY_RUN) {
      await db.collection('reports').updateOne(
        { _id: report._id },
        { $set: { bossX: boss.x, bossY: boss.y } },
      );
    }
  }

  console.log(`  Total reports scanned: ${reports.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Already correct: ${alreadyCorrect}`);
  console.log(`  Skipped (boss gone): ${skippedGone}`);
}

async function migrateRaidReports(db: Db, bossMap: Map<string, { x: number; y: number }>): Promise<void> {
  console.log(`\n--- RaidReports ---`);

  const reports = await db.collection('raidReports').find({
    bossId: { $exists: true },
  }).toArray();

  let updated = 0;
  let skippedGone = 0;
  let alreadyCorrect = 0;

  for (const report of reports) {
    const boss = bossMap.get(report.bossId?.toString());
    if (!boss) {
      skippedGone++;
      continue;
    }
    if (boss.x === report.bossX && boss.y === report.bossY) {
      alreadyCorrect++;
      continue;
    }
    updated++;
    if (!DRY_RUN) {
      await db.collection('raidReports').updateOne(
        { _id: report._id },
        { $set: { bossX: boss.x, bossY: boss.y } },
      );
    }
  }

  console.log(`  Total reports scanned: ${reports.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Already correct: ${alreadyCorrect}`);
  console.log(`  Skipped (boss gone): ${skippedGone}`);
}

async function run() {
  console.log(`MODE: ${DRY_RUN ? 'DRY RUN (no writes)' : '*** LIVE ***'}`);

  const client = await MongoClient.connect(MONGO_URI);

  try {
    const adminDb = client.db('admin');
    const dbs = await adminDb.admin().listDatabases();
    const serverDbs = dbs.databases
      .filter((d: any) => d.name.startsWith(SERVER_DB_PREFIX))
      .map((d: any) => parseInt(d.name.replace(SERVER_DB_PREFIX, '')))
      .sort((a: number, b: number) => a - b);

    for (const serverId of serverDbs) {
      await migrateServer(client, serverId);
    }
  } finally {
    await client.close();
  }

  console.log('\nDone!');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
