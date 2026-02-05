/**
 * Migration Script: Add academyLevel and trait to existing villages
 * 
 * This migration adds:
 * - buildingsLevels.academyLevel = 1 (if missing)
 * - trait = undefined (if missing) - trait is selected in Academy at level 3+
 * 
 * Run with: npx ts-node src/scripts/migrate-academy.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb://localhost:27017';
const DB_NAME = 'users';
const USERS_COLLECTION = 'users';

interface Village {
    villageName: string;
    buildingsLevels: {
        academyLevel?: number;
        [key: string]: any;
    };
    trait?: string;
    [key: string]: any;
}

interface User {
    _id: any;
    username: string;
    villages: Village[];
}

async function migrateAcademy(): Promise<void> {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db(DB_NAME);
        
        // Get all users
        const users = await db.collection(USERS_COLLECTION).find({}).toArray() as User[];
        console.log(`Found ${users.length} users to check`);
        
        let migratedCount = 0;
        let skippedCount = 0;
        
        for (const user of users) {
            console.log(`\nProcessing user: ${user.username}`);
            
            let needsUpdate = false;
            const updatedVillages: Village[] = [];
            
            for (let i = 0; i < user.villages.length; i++) {
                const village = { ...user.villages[i] };
                
                // Add academyLevel if missing
                if (village.buildingsLevels.academyLevel === undefined) {
                    village.buildingsLevels = {
                        ...village.buildingsLevels,
                        academyLevel: 1
                    };
                    needsUpdate = true;
                    console.log(`  - Village "${village.villageName}": Added academyLevel = 1`);
                }
                
                // Add trait if missing (undefined means no trait selected yet)
                if (village.trait === undefined) {
                    // We don't set it - it stays undefined until player chooses at Academy level 3
                    console.log(`  - Village "${village.villageName}": trait is undefined (will be chosen by player)`);
                }
                
                updatedVillages.push(village);
            }
            
            if (needsUpdate) {
                await db.collection(USERS_COLLECTION).updateOne(
                    { _id: user._id },
                    { $set: { villages: updatedVillages } }
                );
                
                migratedCount++;
                console.log(`  ✓ User "${user.username}" migrated successfully`);
            } else {
                skippedCount++;
                console.log(`  - User "${user.username}" already has academyLevel, skipped`);
            }
        }
        
        console.log('\n========================================');
        console.log(`Academy Migration complete!`);
        console.log(`  Migrated: ${migratedCount} users`);
        console.log(`  Skipped:  ${skippedCount} users`);
        console.log('========================================');
        
    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    } finally {
        await client.close();
        console.log('\nMongoDB connection closed');
    }
}

// Run the migration
migrateAcademy().catch(console.error);
