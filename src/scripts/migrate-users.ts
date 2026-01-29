/**
 * Migration Script: Transform old users to new persistence format
 * 
 * Old users are missing:
 * - createdDate (for beginner shield)
 * - pendingClanRequests array
 * - location on each village
 * - supportSent on each village
 * 
 * Run with: npx ts-node src/scripts/migrate-users.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb://localhost:27017';
const DB_NAME = 'users';
const USERS_COLLECTION = 'users';
const GRID_COLLECTION = 'grids';
const WORLD_SIZE = 100;
const PROXIMITY_RANGE = 10;

interface OldVillage {
    villageName: string;
    resourcesAmounts: any;
    buildingsLevels: any;
    population: number;
    resourcesWorkers: any;
    troops: any;
    clanTroops: any;
    woodProductionPerSecond: number;
    stoneProductionPerSecond: number;
    cropProductionPerSecond: number;
    // May or may not have these:
    location?: { x: number; y: number };
    supportSent?: any[];
}

interface OldUser {
    _id: any;
    username: string;
    joinDate?: string;
    createdDate?: Date;
    clanName: string;
    energy: number;
    villages: OldVillage[];
    pendingClanRequests?: string[];
}

async function findRandomAvailableLocation(db: any): Promise<{ x: number; y: number } | null> {
    // Check if there are any existing villages
    const existingVillageCount = await db.collection(GRID_COLLECTION).countDocuments({ taken: true });

    if (existingVillageCount === 0) {
        // First user - place randomly near center
        const centerX = Math.floor(WORLD_SIZE / 2);
        const centerY = Math.floor(WORLD_SIZE / 2);
        
        const nearbyGrid = await db.collection(GRID_COLLECTION).aggregate([
            {
                $match: {
                    taken: false,
                    x: { $gte: centerX - 5, $lte: centerX + 5 },
                    y: { $gte: centerY - 5, $lte: centerY + 5 }
                }
            },
            { $sample: { size: 1 } }
        ]).next();

        if (nearbyGrid) {
            return { x: nearbyGrid.x, y: nearbyGrid.y };
        }
    }

    // Find existing villages and pick a random available spot near one
    const existingVillages = await db.collection(GRID_COLLECTION)
        .find({ taken: true })
        .limit(20)
        .toArray();

    if (existingVillages.length > 0) {
        // Shuffle villages
        const shuffled = existingVillages.sort(() => Math.random() - 0.5);
        
        for (const village of shuffled) {
            const nearbySpot = await db.collection(GRID_COLLECTION).aggregate([
                {
                    $match: {
                        taken: false,
                        x: { $gte: Math.max(0, village.x - PROXIMITY_RANGE), $lte: Math.min(WORLD_SIZE - 1, village.x + PROXIMITY_RANGE) },
                        y: { $gte: Math.max(0, village.y - PROXIMITY_RANGE), $lte: Math.min(WORLD_SIZE - 1, village.y + PROXIMITY_RANGE) }
                    }
                },
                { $sample: { size: 1 } }
            ]).next();

            if (nearbySpot) {
                return { x: nearbySpot.x, y: nearbySpot.y };
            }
        }
    }

    // Fallback: any random available spot
    const anyAvailable = await db.collection(GRID_COLLECTION).aggregate([
        { $match: { taken: false } },
        { $sample: { size: 1 } }
    ]).next();

    if (anyAvailable) {
        return { x: anyAvailable.x, y: anyAvailable.y };
    }

    return null;
}

async function reserveGridCell(db: any, x: number, y: number, username: string, villageName: string): Promise<boolean> {
    const result = await db.collection(GRID_COLLECTION).updateOne(
        { x, y, taken: false },
        { $set: { taken: true, ownerUsername: username, villageName } }
    );
    return result.modifiedCount === 1;
}

async function initializeWorldIfNeeded(db: any): Promise<void> {
    const gridCount = await db.collection(GRID_COLLECTION).countDocuments({});
    const expectedCount = WORLD_SIZE * WORLD_SIZE;
    
    if (gridCount >= expectedCount) {
        console.log('World grid already initialized');
        return;
    }

    console.log('Initializing world grid...');
    
    // Clear partial data
    if (gridCount > 0) {
        await db.collection(GRID_COLLECTION).deleteMany({});
    }

    // Create indexes
    try {
        await db.collection(GRID_COLLECTION).createIndex({ x: 1, y: 1 }, { unique: true });
        await db.collection(GRID_COLLECTION).createIndex({ taken: 1 });
        await db.collection(GRID_COLLECTION).createIndex({ ownerUsername: 1 });
    } catch (e) {
        // Indexes might already exist
    }

    // Insert grids in batches
    const batchSize = 1000;
    for (let batchStart = 0; batchStart < expectedCount; batchStart += batchSize) {
        const grids: any[] = [];
        for (let i = batchStart; i < Math.min(batchStart + batchSize, expectedCount); i++) {
            const x = i % WORLD_SIZE;
            const y = Math.floor(i / WORLD_SIZE);
            grids.push({ x, y, taken: false });
        }
        try {
            await db.collection(GRID_COLLECTION).insertMany(grids, { ordered: false });
        } catch (e) {
            // Some might already exist
        }
        console.log(`  Inserted grid cells ${batchStart} - ${Math.min(batchStart + batchSize, expectedCount)}`);
    }
    
    console.log('World grid initialized!');
}

async function migrateUsers(): Promise<void> {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db(DB_NAME);
        
        // Initialize world grid if needed
        await initializeWorldIfNeeded(db);
        
        // Get all users
        const users = await db.collection(USERS_COLLECTION).find({}).toArray() as OldUser[];
        console.log(`Found ${users.length} users to migrate`);
        
        let migratedCount = 0;
        let skippedCount = 0;
        
        for (const user of users) {
            console.log(`\nProcessing user: ${user.username}`);
            
            let needsUpdate = false;
            const updates: any = {};
            
            // Add createdDate if missing (set to today)
            if (!user.createdDate) {
                updates.createdDate = new Date();
                needsUpdate = true;
                console.log(`  - Adding createdDate: ${updates.createdDate}`);
            }
            
            // Add pendingClanRequests if missing
            if (!user.pendingClanRequests) {
                updates.pendingClanRequests = [];
                needsUpdate = true;
                console.log(`  - Adding pendingClanRequests: []`);
            }
            
            // Process each village
            const updatedVillages = [];
            for (let i = 0; i < user.villages.length; i++) {
                const village = user.villages[i];
                const updatedVillage = { ...village };
                
                // Add location if missing
                if (!village.location) {
                    const location = await findRandomAvailableLocation(db);
                    if (location) {
                        const reserved = await reserveGridCell(db, location.x, location.y, user.username, village.villageName);
                        if (reserved) {
                            updatedVillage.location = location;
                            needsUpdate = true;
                            console.log(`  - Village "${village.villageName}" assigned location: (${location.x}, ${location.y})`);
                        } else {
                            console.log(`  - WARNING: Could not reserve location for village "${village.villageName}"`);
                        }
                    } else {
                        console.log(`  - WARNING: No available location for village "${village.villageName}"`);
                    }
                } else {
                    console.log(`  - Village "${village.villageName}" already has location: (${village.location.x}, ${village.location.y})`);
                }
                
                // Add supportSent if missing
                if (!village.supportSent) {
                    updatedVillage.supportSent = [];
                    needsUpdate = true;
                    console.log(`  - Adding supportSent to village "${village.villageName}"`);
                }
                
                updatedVillages.push(updatedVillage);
            }
            
            if (needsUpdate) {
                updates.villages = updatedVillages;
                
                await db.collection(USERS_COLLECTION).updateOne(
                    { _id: user._id },
                    { $set: updates }
                );
                
                migratedCount++;
                console.log(`  ✓ User "${user.username}" migrated successfully`);
            } else {
                skippedCount++;
                console.log(`  - User "${user.username}" already up to date, skipped`);
            }
        }
        
        console.log('\n========================================');
        console.log(`Migration complete!`);
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
migrateUsers().catch(console.error);
