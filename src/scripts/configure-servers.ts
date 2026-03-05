import { MongoClient } from 'mongodb';

const url = 'mongodb://localhost:27017/';
const accountsDbName = 'pasiflora_accounts';
const SERVERS_COLLECTION = 'servers';

async function run() {
  const client = await MongoClient.connect(url);
  const accountsDb = client.db(accountsDbName);
  const coll = accountsDb.collection(SERVERS_COLLECTION);

  console.log('Configuring servers: closing Server 1 for registration and creating/opening Server 2.');

  // Ensure Server 1 exists and is marked as closed for registration
  await coll.updateOne(
    { serverId: 1 },
    {
      $set: {
        serverId: 1,
        name: 'Server 1',
        status: 'active',
        isClosed: true,
      },
      $setOnInsert: {
        playerCount: 0,
      },
    },
    { upsert: true },
  );

  // Ensure Server 2 exists and is open
  const existing2 = await coll.findOne({ serverId: 2 });
  if (!existing2) {
    await coll.insertOne({
      serverId: 2,
      name: 'Server 2',
      status: 'active',
      isClosed: false,
      playerCount: 0,
    });
    console.log('Created Server 2 (open for registration).');
  } else {
    await coll.updateOne(
      { serverId: 2 },
      {
        $set: {
          status: existing2.status ?? 'active',
          isClosed: false,
        },
      },
    );
  }

  console.log('Server configuration complete.');
  await client.close();
}

run().catch((err) => {
  console.error('configure-servers failed', err);
  process.exit(1);
});

