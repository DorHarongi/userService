import { DbConnectorService } from '../database/services/db-connector.service';

async function run() {
    const connector = new DbConnectorService();
    const db = await connector.connect();

    const users = db.collection('users');

    // Initialize weeklyStats, totalStats, and selectedTitle for all users
    await users.updateMany(
        {},
        {
            $set: {
                'weeklyStats.bossDamage': 0,
                'weeklyStats.resourcesStolen': 0,
                'weeklyStats.successfulDefenses': 0,
                'totalStats.lifetimeBossDamage': 0,
                'totalStats.lifetimeResourcesStolen': 0,
                'totalStats.totalBattlesWon': 0,
                selectedTitle: null,
            },
        },
    );

    console.log('migrate-chunk2.ts completed successfully');
}

run()
    .then(() => {
        console.log('Migration finished');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Migration failed', err);
        process.exit(1);
    });

