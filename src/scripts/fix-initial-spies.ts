import { MongoClient } from 'mongodb';
import { getMaxSpies } from 'utils';

const url = 'mongodb://localhost:27017/';
const dbNames = ['users', 'pasiflora_server_1', 'pasiflora_server_2'];

async function run() {
  const client = await MongoClient.connect(url);

  for (const dbName of dbNames) {
    const db = client.db(dbName);
    const users = db.collection('users');

    console.log(`Fixing spies in DB: ${dbName}`);

    const cursor = users.find({
      'villages.buildingsLevels.stableLevel': { $gte: 1 },
    });

    while (await cursor.hasNext()) {
      const user = await cursor.next() as any;
      if (!user) continue;

      let changed = false;

      for (const village of user.villages || []) {
        const stableLevel = village.buildingsLevels?.stableLevel || 0;
        if (stableLevel <= 0) continue;

        const maxSpies = getMaxSpies(stableLevel);
        const aliveSpies = village.aliveSpies ?? 0;
        const deathTimestamps = village.spyDeathTimestamps || [];

        if ((aliveSpies <= 0) && (!deathTimestamps || deathTimestamps.length === 0)) {
          village.aliveSpies = maxSpies;
          village.spyDeathTimestamps = [];
          changed = true;
        }
      }

      if (changed) {
        await users.updateOne(
          { _id: user._id },
          { $set: { villages: user.villages } },
        );
      }
    }
  }

  console.log('Finished fixing initial spies.');
  await client.close();
}

run().catch((err) => {
  console.error('fix-initial-spies failed', err);
  process.exit(1);
});

