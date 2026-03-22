import { MongoClient, Db, ObjectId } from 'mongodb';

const MONGO_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const SERVER_DB_PREFIX = 'pasiflora_server_';
const DRY_RUN = false;

interface SpamVictim {
  username: string;
  oasisAttackId: string;
  oasisId: string;
  firstReturnDate: Date;
  spamReturnIds: ObjectId[];
  spamReportIds: ObjectId[];
  spamMessageIds: ObjectId[];
  legitimateReturnId?: ObjectId;
}

async function findSpamVictims(db: Db): Promise<SpamVictim[]> {
  const victims: SpamVictim[] = [];

  // Find users with an abnormal number of oasis_return movements (> 50)
  const pipeline = [
    { $match: { type: 'oasis_return' } },
    { $group: { _id: '$senderUsername', count: { $sum: 1 } } },
    { $match: { count: { $gt: 50 } } },
    { $sort: { count: -1 } },
  ];
  const suspects = await db.collection('movements').aggregate(pipeline).toArray();

  for (const suspect of suspects) {
    const username = suspect._id;
    console.log(`\n  Checking ${username} (${suspect.count} oasis_returns)...`);

    // Find the stuck oasis_attack that caused the loop
    const attacks = await db.collection('movements').find({
      senderUsername: username,
      type: 'oasis_attack',
    }).toArray();

    for (const attack of attacks) {
      const oasisId = attack.oasisId;

      // Get all returns for this oasis
      const returns = await db.collection('movements').find({
        senderUsername: username,
        type: 'oasis_return',
        oasisId: oasisId,
      }).sort({ arrivalTime: 1 }).toArray();

      if (returns.length <= 50) continue;

      // The first return is legitimate (from the actual combat), the rest are spam
      const legitimateReturn = returns[0];
      const spamReturns = returns.slice(1);

      // Find self-combat reports (user attacked their own oasis repeatedly)
      const selfReports = await db.collection('reports').find({
        attackerName: username,
        defenderName: username,
        reportType: 'oasis',
      }).toArray();

      // Find spam "Oasis Troops Returned" messages after the first legitimate one
      const firstReturnDate = new Date(legitimateReturn.arrivalTime);
      const oasisRefPattern = new RegExp(oasisId);
      const allOasisMessages = await db.collection('messages').find({
        recipientUsername: username,
        subject: 'Oasis Troops Returned',
        content: { $regex: oasisRefPattern },
      }).sort({ date: 1 }).toArray();

      // Keep the first message, rest are spam
      const spamMessages = allOasisMessages.length > 1 ? allOasisMessages.slice(1) : [];

      console.log(`    Oasis ${oasisId}: ${spamReturns.length} spam returns, ${selfReports.length} self-reports, ${spamMessages.length} spam messages`);

      victims.push({
        username,
        oasisAttackId: attack._id.toString(),
        oasisId,
        firstReturnDate,
        spamReturnIds: spamReturns.map(r => r._id),
        spamReportIds: selfReports.map(r => r._id),
        spamMessageIds: spamMessages.map(m => m._id),
        legitimateReturnId: legitimateReturn._id,
      });
    }
  }

  return victims;
}

async function cleanupServer(client: MongoClient, serverId: number): Promise<void> {
  const dbName = `${SERVER_DB_PREFIX}${serverId}`;
  const db = client.db(dbName);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Server ${serverId} (${dbName})`);
  console.log(`${'='.repeat(50)}`);

  const victims = await findSpamVictims(db);

  if (victims.length === 0) {
    console.log('  No spam victims found');
    return;
  }

  for (const victim of victims) {
    console.log(`\n  Cleaning up ${victim.username}:`);
    console.log(`    Spam returns to delete: ${victim.spamReturnIds.length}`);
    console.log(`    Self-combat reports to delete: ${victim.spamReportIds.length}`);
    console.log(`    Spam messages to delete: ${victim.spamMessageIds.length}`);

    if (!DRY_RUN) {
      // Delete spam oasis_return movements
      if (victim.spamReturnIds.length > 0) {
        const res = await db.collection('movements').deleteMany({
          _id: { $in: victim.spamReturnIds },
        });
        console.log(`    Deleted ${res.deletedCount} spam return movements`);
      }

      // Delete self-combat reports
      if (victim.spamReportIds.length > 0) {
        const res = await db.collection('reports').deleteMany({
          _id: { $in: victim.spamReportIds },
        });
        console.log(`    Deleted ${res.deletedCount} self-combat reports`);
      }

      // Delete spam messages
      if (victim.spamMessageIds.length > 0) {
        const res = await db.collection('messages').deleteMany({
          _id: { $in: victim.spamMessageIds },
        });
        console.log(`    Deleted ${res.deletedCount} spam messages`);
      }

      // Fix troopsInTransit (it was decremented too many times)
      // Reset to 0 since all movements are completed and no troops are actually in transit
      const user = await db.collection('users').findOne({ username: victim.username });
      if (user?.villages) {
        for (let vi = 0; vi < user.villages.length; vi++) {
          const village = user.villages[vi];
          const tit = village.troopsInTransit;
          if (tit !== undefined && tit < 0) {
            console.log(`    Fixing troopsInTransit for "${village.villageName}": ${tit} -> 0`);
            await db.collection('users').updateOne(
              { username: victim.username, 'villages.villageName': village.villageName },
              { $set: { 'villages.$.troopsInTransit': 0 } },
            );
          }
        }
      }
    }
  }
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
      await cleanupServer(client, serverId);
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
