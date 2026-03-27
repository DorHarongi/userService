/**
 * Migration script: soft-delete inactive players on server 2.
 * Players with no lastLoginDate or lastLoginDate > 10 days ago get isDeleted: true.
 *
 * Usage: npx ts-node src/scripts/soft-delete-inactive.ts
 */
import { MongoClient } from 'mongodb';

const URI = 'mongodb://pasiflora:dormongo@129.159.146.118:27017/?authSource=admin';
const DB_NAME = 'pasiflora_server_2';
const INACTIVITY_DAYS = 10;

async function main() {
    const client = new MongoClient(URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const users = db.collection('users');
    const oases = db.collection('oases');
    const movements = db.collection('movements');

    const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    const inactive = await users.find({
        isDeleted: { $ne: true },
        $or: [
            { lastLoginDate: { $exists: false } },
            { lastLoginDate: null },
            { lastLoginDate: { $lt: cutoff } },
        ],
    }).toArray();

    console.log(`Found ${inactive.length} inactive player(s) to soft-delete:\n`);

    for (const user of inactive) {
        const loginStr = user.lastLoginDate
            ? new Date(user.lastLoginDate).toISOString()
            : 'NEVER';
        console.log(`  ${user.username} | lastLogin: ${loginStr} | clan: "${user.clanName || ''}" | villages: ${user.villages?.length || 0}`);

        // Check oasis garrisons
        const userOases = await oases.find({ 'garrison.username': user.username }).toArray();
        if (userOases.length > 0) {
            console.log(`    -> Has ${userOases.length} oasis garrison(s) — clearing`);
            for (const oasis of userOases) {
                await oases.updateOne({ _id: oasis._id }, { $unset: { garrison: '' } });
            }
        }

        // Check outgoing movements
        const outgoing = await movements.countDocuments({
            senderUsername: user.username,
            status: 'in_transit',
        });
        if (outgoing > 0) {
            console.log(`    -> Has ${outgoing} outgoing movement(s) — deleting`);
            await movements.deleteMany({
                senderUsername: user.username,
                status: 'in_transit',
            });
        }

        // Set isDeleted
        await users.updateOne(
            { _id: user._id },
            { $set: { isDeleted: true } },
        );
        console.log(`    -> isDeleted: true ✓`);
    }

    // Verify
    const deletedCount = await users.countDocuments({ isDeleted: true });
    const activeCount = await users.countDocuments({ isDeleted: { $ne: true } });
    console.log(`\nDone. Total deleted: ${deletedCount} | Total active: ${activeCount}`);

    await client.close();
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
