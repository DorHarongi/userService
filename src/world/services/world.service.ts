import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { Grid, IGrid } from '../models/grid.entity';
import { Location } from '../../user/models/location';

const GRID_COLLECTION = "grids";
const USERS_COLLECTION = "users";
const OASES_COLLECTION = "oases";
const BOSSES_COLLECTION = "bosses";
const WORLD_SIZE = 100;

// V2 spawning parameters
const PROXIMITY_RANGE = 20;
const SPARSE_CHANCE = 0.35;
const CANDIDATES = 15;
const SAFE_RADIUS = 8;

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

    private async getOccupiedCoords(): Promise<Array<{ x: number; y: number }>> {
        const [oases, bosses] = await Promise.all([
            this.dbAccessorService.getCollection(OASES_COLLECTION).find({}, { projection: { x: 1, y: 1 } }).toArray(),
            this.dbAccessorService.getCollection(BOSSES_COLLECTION).find({ isDefeated: false }, { projection: { x: 1, y: 1 } }).toArray(),
        ]);
        return [...oases, ...bosses].map(e => ({ x: e.x, y: e.y }));
    }

    private buildExclusionFilter(occupied: Array<{ x: number; y: number }>): Record<string, any> {
        if (occupied.length === 0) return {};
        return { $nor: occupied.map(c => ({ x: c.x, y: c.y })) };
    }

    async findLocationForNewVillage(): Promise<Location> {
        const totalGrids = await this.dbAccessorService.getCollection(GRID_COLLECTION).countDocuments({});
        if (totalGrids === 0) {
            return new Location(Math.floor(WORLD_SIZE / 2), Math.floor(WORLD_SIZE / 2));
        }

        const occupied = await this.getOccupiedCoords();
        const exclusion = this.buildExclusionFilter(occupied);

        const existingVillageCount = await this.dbAccessorService.getCollection(GRID_COLLECTION).countDocuments({ taken: true });

        if (existingVillageCount === 0) {
            const centerX = Math.floor(WORLD_SIZE / 2);
            const centerY = Math.floor(WORLD_SIZE / 2);
            const nearbyGrid = await this.sampleFreeNear(centerX, centerY, 5, exclusion);
            if (nearbyGrid) return new Location(nearbyGrid.x, nearbyGrid.y);
        }

        if (Math.random() < SPARSE_CHANCE) {
            const loc = await this.findSparseLocation(exclusion);
            if (loc) return loc;
        }

        const anchor = await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
            { $match: { taken: true } },
            { $sample: { size: 1 } },
        ]).next() as IGrid;

        if (anchor) {
            const spot = await this.sampleFreeNear(anchor.x, anchor.y, PROXIMITY_RANGE, exclusion);
            if (spot) return new Location(spot.x, spot.y);
        }

        const any = await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
            { $match: { taken: false, ...exclusion } },
            { $sample: { size: 1 } },
        ]).next() as IGrid;

        if (any) return new Location(any.x, any.y);

        throw new HttpException("No available grid locations", HttpStatus.SERVICE_UNAVAILABLE);
    }

    private async findSparseLocation(exclusion: Record<string, any>): Promise<Location | null> {
        let best: IGrid | null = null;
        let bestDensity = Infinity;

        for (let i = 0; i < CANDIDATES; i++) {
            const candidate = await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
                { $match: { taken: false, ...exclusion } },
                { $sample: { size: 1 } },
            ]).next() as IGrid | null;
            if (!candidate) continue;

            const neighbors = await this.dbAccessorService.getCollection(GRID_COLLECTION).countDocuments({
                taken: true,
                x: { $gte: candidate.x - SAFE_RADIUS, $lte: candidate.x + SAFE_RADIUS },
                y: { $gte: candidate.y - SAFE_RADIUS, $lte: candidate.y + SAFE_RADIUS },
            });

            if (neighbors < bestDensity) {
                bestDensity = neighbors;
                best = candidate;
            }
        }

        return best ? new Location(best.x, best.y) : null;
    }

    private async sampleFreeNear(cx: number, cy: number, range: number, exclusion: Record<string, any> = {}): Promise<IGrid | null> {
        return await this.dbAccessorService.getCollection(GRID_COLLECTION).aggregate([
            {
                $match: {
                    taken: false,
                    x: { $gte: Math.max(0, cx - range), $lte: Math.min(WORLD_SIZE - 1, cx + range) },
                    y: { $gte: Math.max(0, cy - range), $lte: Math.min(WORLD_SIZE - 1, cy + range) },
                    ...exclusion,
                },
            },
            { $sample: { size: 1 } },
        ]).next() as IGrid | null;
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

    async isCellOccupiedByOasis(x: number, y: number): Promise<boolean> {
        const oasis = await this.dbAccessorService.getCollection(OASES_COLLECTION).findOne({ x, y });
        return !!oasis;
    }

    async isCellOccupiedByBossOrOasis(x: number, y: number): Promise<boolean> {
        const [oasis, boss] = await Promise.all([
            this.dbAccessorService.getCollection(OASES_COLLECTION).findOne({ x, y }),
            this.dbAccessorService.getCollection(BOSSES_COLLECTION).findOne({ x, y, isDefeated: false }),
        ]);
        return !!(oasis || boss);
    }

    getWorldSize(): number {
        return WORLD_SIZE;
    }

    // Update village name on the grid
    async updateVillageName(x: number, y: number, newVillageName: string): Promise<void> {
        await this.dbAccessorService.getCollection(GRID_COLLECTION).updateOne(
            { x, y },
            { $set: { villageName: newVillageName } }
        );
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
