import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { Grid, IGrid } from '../models/grid.entity';
import { Location } from '../../user/models/location';

const GRID_COLLECTION = "grids";
const USERS_COLLECTION = "users";
const WORLD_SIZE = 100; // 100x100 map
const PROXIMITY_RANGE = 10; // Range for proximity-based spawning

@Injectable()
export class WorldService {
    constructor(private dbAccessorService: DbAccessorService) {}

    // Initialize the world grid (run once on first startup if needed)
    async initializeWorld(): Promise<void> {
        // Check if world is already fully initialized (should have 10000 cells for 100x100)
        const gridCount = await this.dbAccessorService.getCollection(GRID_COLLECTION).countDocuments({});
        const expectedCount = WORLD_SIZE * WORLD_SIZE;
        
        if (gridCount >= expectedCount) {
            return; // World already initialized
        }

        // If partial data exists, clear it and start fresh
        if (gridCount > 0 && gridCount < expectedCount) {
            await this.dbAccessorService.getCollection(GRID_COLLECTION).deleteMany({});
        }

        // Create indexes FIRST before inserting data
        try {
            await this.dbAccessorService.getCollection(GRID_COLLECTION).createIndex({ x: 1, y: 1 }, { unique: true });
            await this.dbAccessorService.getCollection(GRID_COLLECTION).createIndex({ taken: 1 });
            await this.dbAccessorService.getCollection(GRID_COLLECTION).createIndex({ ownerUsername: 1 });
        } catch (e) {
            // Indexes might already exist, that's fine
        }

        // Insert grids in batches to avoid memory issues
        const batchSize = 1000;
        for (let batchStart = 0; batchStart < expectedCount; batchStart += batchSize) {
            const grids: Grid[] = [];
            for (let i = batchStart; i < Math.min(batchStart + batchSize, expectedCount); i++) {
                const x = i % WORLD_SIZE;
                const y = Math.floor(i / WORLD_SIZE);
                grids.push(new Grid(x, y, false));
            }
            try {
                await this.dbAccessorService.getCollection(GRID_COLLECTION).insertMany(grids, { ordered: false });
            } catch (e) {
                // Some might already exist due to unique index, that's fine with ordered: false
            }
        }
    }

    // Get a grid cell at specific coordinates
    async getGridAt(x: number, y: number): Promise<IGrid | null> {
        return await this.dbAccessorService.getCollection(GRID_COLLECTION).findOne({ x, y }) as IGrid;
    }

    // Get all villages in a 10x10 window for map display
    async getVillagesInWindow(startX: number, startY: number, size: number = 10): Promise<IGrid[]> {
        const grids = await this.dbAccessorService.getCollection(GRID_COLLECTION).find({
            x: { $gte: startX, $lt: startX + size },
            y: { $gte: startY, $lt: startY + size },
            taken: true
        }).toArray();
        return grids as IGrid[];
    }

    // Get all villages for minimap (returns only taken grids)
    async getAllVillages(): Promise<IGrid[]> {
        const grids = await this.dbAccessorService.getCollection(GRID_COLLECTION).find({
            taken: true
        }).toArray();
        return grids as IGrid[];
    }

    // Find a location for a new village using proximity-based placement
    // Based on the original developer's intended logic
    async findLocationForNewVillage(): Promise<Location> {
        // Check if world is initialized
        const totalGrids = await this.dbAccessorService.getCollection(GRID_COLLECTION).countDocuments({});
        if (totalGrids === 0) {
            // World not initialized - return center location and let reserveGrid handle it
            return new Location(Math.floor(WORLD_SIZE / 2), Math.floor(WORLD_SIZE / 2));
        }

        // First, check if there are any existing villages
        const existingVillageCount = await this.dbAccessorService.getCollection(GRID_COLLECTION).countDocuments({ taken: true });

        if (existingVillageCount === 0) {
            // First player - place randomly near center of the map
            const centerX = Math.floor(WORLD_SIZE / 2);
            const centerY = Math.floor(WORLD_SIZE / 2);
            
            // Find a RANDOM available spot near center using $sample
            const nearbyGrid = await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
                {
                    $match: {
                        taken: false,
                        x: { $gte: centerX - 5, $lte: centerX + 5 },
                        y: { $gte: centerY - 5, $lte: centerY + 5 }
                    }
                },
                { $sample: { size: 1 } }
            ]).next() as IGrid;

            if (nearbyGrid) {
                return new Location(nearbyGrid.x, nearbyGrid.y);
            }
        }

        // Find existing villages and pick a random available spot near one
        const existingVillages = await this.dbAccessorService.getCollection(GRID_COLLECTION)
            .find({ taken: true })
            .limit(20)
            .toArray() as IGrid[];

        if (existingVillages.length > 0) {
            // Shuffle and try to find a RANDOM spot near each village
            for (const village of existingVillages.sort(() => Math.random() - 0.5)) {
                const nearbySpot = await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
                    {
                        $match: {
                            taken: false,
                            x: { $gte: Math.max(0, village.x - PROXIMITY_RANGE), $lte: Math.min(WORLD_SIZE - 1, village.x + PROXIMITY_RANGE) },
                            y: { $gte: Math.max(0, village.y - PROXIMITY_RANGE), $lte: Math.min(WORLD_SIZE - 1, village.y + PROXIMITY_RANGE) }
                        }
                    },
                    { $sample: { size: 1 } }
                ]).next() as IGrid;

                if (nearbySpot) {
                    return new Location(nearbySpot.x, nearbySpot.y);
                }
            }
        }

        // Fallback: if no spot found near existing villages, find any random available spot
        const anyAvailableGrid = await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
            { $match: { taken: false } },
            { $sample: { size: 1 } }
        ]).next() as IGrid;

        if (anyAvailableGrid) {
            return new Location(anyAvailableGrid.x, anyAvailableGrid.y);
        }

        throw new HttpException("No available grid locations", HttpStatus.SERVICE_UNAVAILABLE);
    }

    // Reserve a grid cell for a new village
    async reserveGridForVillage(x: number, y: number, ownerUsername: string, villageName: string): Promise<boolean> {
        const result = await this.dbAccessorService.getCollection(GRID_COLLECTION).updateOne(
            { x, y, taken: false },
            { $set: { taken: true, ownerUsername, villageName } }
        );
        return result.modifiedCount === 1;
    }

    // Find location near an existing village (for creating additional villages)
    async findLocationNearVillage(centerX: number, centerY: number): Promise<Location | null> {
        const nearbyGrid = await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
            {
                $match: {
                    taken: false,
                    x: { $gte: Math.max(0, centerX - 5), $lte: Math.min(WORLD_SIZE - 1, centerX + 5) },
                    y: { $gte: Math.max(0, centerY - 5), $lte: Math.min(WORLD_SIZE - 1, centerY + 5) }
                }
            },
            { $sample: { size: 1 } }
        ]).next() as IGrid;

        if (nearbyGrid) {
            return new Location(nearbyGrid.x, nearbyGrid.y);
        }
        return null;
    }

    // Get available cells in a small window around a village (for new village creation UI)
    async getAvailableCellsNearVillage(centerX: number, centerY: number, range: number = 5): Promise<IGrid[]> {
        const grids = await this.dbAccessorService.getCollection(GRID_COLLECTION).find({
            x: { $gte: Math.max(0, centerX - range), $lte: Math.min(WORLD_SIZE - 1, centerX + range) },
            y: { $gte: Math.max(0, centerY - range), $lte: Math.min(WORLD_SIZE - 1, centerY + range) },
            taken: false
        }).toArray();
        return grids as IGrid[];
    }

    getWorldSize(): number {
        return WORLD_SIZE;
    }

    // Reset the world grid (clear all data)
    async resetWorld(): Promise<void> {
        await this.dbAccessorService.getCollection(GRID_COLLECTION).deleteMany({});
    }

    // Dev only: Reset everything for fresh start
    async devResetAll(): Promise<void> {
        await this.dbAccessorService.getCollection(GRID_COLLECTION).deleteMany({});
        await this.dbAccessorService.getCollection(USERS_COLLECTION).deleteMany({});
        await this.dbAccessorService.getCollection('clans').deleteMany({});
        await this.dbAccessorService.getCollection('messages').deleteMany({});
        await this.dbAccessorService.getCollection('attackReports').deleteMany({});
    }
}
