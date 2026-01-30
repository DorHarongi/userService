/**
 * Migration Script: Calculate currentQuestIndex for existing users
 * 
 * This script analyzes each user's current state (building levels, troops, workers)
 * and determines which quest they should be on based on completed conditions.
 * 
 * Run with: npx ts-node src/scripts/migrate-quest-index.ts
 */

import { MongoClient } from 'mongodb';
import { QUESTS, QuestCompletionType, TOTAL_QUESTS } from 'utils';

const MONGODB_URI = 'mongodb://localhost:27017';
const DB_NAME = 'users';
const USERS_COLLECTION = 'users';

interface Village {
    villageName: string;
    buildingsLevels: {
        centerBuildingLevel: number;
        woodFactoryLevel: number;
        stoneMineLevel: number;
        cropFarmLevel: number;
        arsenalLevel: number;
        quartersLevel: number;
        woodWarehouseLevel: number;
        stoneWarehouseLevel: number;
        cropWarehouseLevel: number;
        wallLevel: number;
        embassyLevel: number;
    };
    troops: {
        spearFighters: number;
        swordFighters: number;
        axeFighters: number;
        archers: number;
        magicians: number;
        horsemen: number;
        catapults: number;
    };
    resourcesWorkers: {
        woodWorkers: number;
        stoneWorkers: number;
        cropWorkers: number;
    };
}

interface User {
    _id: any;
    username: string;
    villages: Village[];
    currentQuestIndex?: number;
}

function getBuildingLevel(village: Village, buildingName: string): number {
    const buildingMap: { [key: string]: number } = {
        'centerBuilding': village.buildingsLevels?.centerBuildingLevel || 1,
        'woodFactory': village.buildingsLevels?.woodFactoryLevel || 1,
        'stoneMine': village.buildingsLevels?.stoneMineLevel || 1,
        'cropFarm': village.buildingsLevels?.cropFarmLevel || 1,
        'arsenal': village.buildingsLevels?.arsenalLevel || 1,
        'quarters': village.buildingsLevels?.quartersLevel || 1,
        'woodWarehouse': village.buildingsLevels?.woodWarehouseLevel || 1,
        'stoneWarehouse': village.buildingsLevels?.stoneWarehouseLevel || 1,
        'cropWarehouse': village.buildingsLevels?.cropWarehouseLevel || 1,
        'wall': village.buildingsLevels?.wallLevel || 1,
        'embassy': village.buildingsLevels?.embassyLevel || 1,
    };
    return buildingMap[buildingName] || 1;
}

function getTotalTroops(village: Village): number {
    const troops = village.troops;
    if (!troops) return 0;
    return (troops.spearFighters || 0) + 
           (troops.swordFighters || 0) + 
           (troops.axeFighters || 0) + 
           (troops.archers || 0) + 
           (troops.magicians || 0) + 
           (troops.horsemen || 0) + 
           (troops.catapults || 0);
}

function getTotalWorkers(village: Village): number {
    const workers = village.resourcesWorkers;
    if (!workers) return 0;
    return (workers.woodWorkers || 0) + 
           (workers.stoneWorkers || 0) + 
           (workers.cropWorkers || 0);
}

function isQuestCompleted(questIndex: number, village: Village): boolean {
    const quest = QUESTS[questIndex - 1];
    if (!quest) return false;

    const condition = quest.condition;

    switch (condition.type) {
        case QuestCompletionType.BUILDING_LEVEL:
            const currentLevel = getBuildingLevel(village, condition.buildingName || '');
            return currentLevel >= (condition.level || 0);

        case QuestCompletionType.TRAIN_TROOPS:
            const totalTroops = getTotalTroops(village);
            return totalTroops >= (condition.count || 0);

        case QuestCompletionType.HIRE_WORKERS:
            const totalWorkers = getTotalWorkers(village);
            return totalWorkers >= (condition.count || 0);

        default:
            return false;
    }
}

function calculateCurrentQuestIndex(user: User): number {
    // Only first village can have quests
    if (!user.villages || user.villages.length === 0) {
        return 1;
    }

    // Users with multiple villages have completed beginner quests
    if (user.villages.length > 1) {
        return TOTAL_QUESTS + 1;
    }

    const firstVillage = user.villages[0];

    // Find the first quest that is NOT completed
    for (let i = 1; i <= TOTAL_QUESTS; i++) {
        if (!isQuestCompleted(i, firstVillage)) {
            return i;
        }
    }

    // All quests completed
    return TOTAL_QUESTS + 1;
}

async function migrateQuestIndex(): Promise<void> {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db(DB_NAME);
        
        // Get all users
        const users = await db.collection(USERS_COLLECTION).find({}).toArray() as User[];
        console.log(`Found ${users.length} users to process`);
        
        let migratedCount = 0;
        let skippedCount = 0;
        
        for (const user of users) {
            console.log(`\nProcessing user: ${user.username}`);
            
            // Skip if already has currentQuestIndex set
            if (user.currentQuestIndex !== undefined && user.currentQuestIndex !== null) {
                skippedCount++;
                console.log(`  - Already has currentQuestIndex: ${user.currentQuestIndex}, skipped`);
                continue;
            }
            
            const calculatedIndex = calculateCurrentQuestIndex(user);
            
            await db.collection(USERS_COLLECTION).updateOne(
                { _id: user._id },
                { $set: { currentQuestIndex: calculatedIndex } }
            );
            
            migratedCount++;
            console.log(`  ✓ Set currentQuestIndex to ${calculatedIndex}`);
            
            // Log why this index was chosen
            if (calculatedIndex > TOTAL_QUESTS) {
                console.log(`    (Completed all quests or has multiple villages)`);
            } else {
                const quest = QUESTS[calculatedIndex - 1];
                console.log(`    (Next quest: ${quest.title})`);
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
migrateQuestIndex().catch(console.error);
