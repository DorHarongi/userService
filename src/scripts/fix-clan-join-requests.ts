/**
 * Migration script to mark all old clan join request messages as non-actionable.
 * 
 * Run with: npx ts-node src/scripts/fix-clan-join-requests.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'tribalWars';

async function fixClanJoinRequests() {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db(DB_NAME);
        const messagesCollection = db.collection('messages');
        
        // Find all actionable clan join requests
        const countBefore = await messagesCollection.countDocuments({
            type: 'clan_join_request',
            actionable: true
        });
        
        console.log(`Found ${countBefore} actionable clan join request messages`);
        
        if (countBefore === 0) {
            console.log('No messages to update. Exiting.');
            return;
        }
        
        // Update all clan join requests to be non-actionable
        const result = await messagesCollection.updateMany(
            { 
                type: 'clan_join_request',
                actionable: true 
            },
            { 
                $set: { 
                    actionable: false,
                    read: true 
                } 
            }
        );
        
        console.log(`Updated ${result.modifiedCount} messages`);
        
        // Verify
        const countAfter = await messagesCollection.countDocuments({
            type: 'clan_join_request',
            actionable: true
        });
        
        console.log(`Remaining actionable clan join requests: ${countAfter}`);
        console.log('Migration completed successfully!');
        
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
        console.log('Disconnected from MongoDB');
    }
}

fixClanJoinRequests();
