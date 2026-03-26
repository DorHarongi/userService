import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/';
const DB_NAMES = ['pasiflora_server_1', 'pasiflora_server_2'];

async function run() {
  const client = await MongoClient.connect(MONGO_URI);

  for (const dbName of DB_NAMES) {
    const db = client.db(dbName);
    console.log(`\n=== ${dbName} ===`);

    const affected = await db.collection('users').countDocuments({
      'villages.skills.selfDefense': { $exists: true },
    });
    console.log(`Users with selfDefense field: ${affected}`);

    const result = await db.collection('users').updateMany(
      { 'villages.skills.selfDefense': { $exists: true } },
      { $unset: { 'villages.$[].skills.selfDefense': '' } },
    );
    console.log(`Modified: ${result.modifiedCount}`);

    const remaining = await db.collection('users').countDocuments({
      'villages.skills.selfDefense': { $exists: true },
    });
    console.log(`Remaining after cleanup: ${remaining}`);
  }

  await client.close();
  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
