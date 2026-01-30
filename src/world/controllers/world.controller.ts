import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { WorldService } from '../services/world.service';
import { MapWindowRequestDTO, MapWindowResponseDTO, MinimapResponseDTO, VillageOnMapDTO } from '../dtos/mapWindowDTO';
import { DbAccessorService } from '../../database/services/db-accessor.service';

@Controller('world')
export class WorldController {
    constructor(
        private worldService: WorldService,
        private dbAccessorService: DbAccessorService
    ) {}

    @Get('map')
    async getMapWindow(@Query('startX') startX: string, @Query('startY') startY: string): Promise<MapWindowResponseDTO> {
        const x = parseInt(startX) || 0;
        const y = parseInt(startY) || 0;
        
        const villages = await this.worldService.getVillagesInWindow(x, y);
        
        // Look up clan names for each owner
        const ownerUsernames = [...new Set(villages.map(v => v.ownerUsername).filter(Boolean))];
        const users = await this.dbAccessorService.getCollection('users').find({
            username: { $in: ownerUsernames }
        }).project({ username: 1, clanName: 1 }).toArray();
        
        const userClanMap = new Map<string, string>();
        users.forEach((u: any) => {
            if (u.clanName) userClanMap.set(u.username, u.clanName);
        });
        
        const villagesDTO: VillageOnMapDTO[] = villages.map(v => ({
            x: v.x,
            y: v.y,
            ownerUsername: v.ownerUsername || '',
            villageName: v.villageName || '',
            clanName: userClanMap.get(v.ownerUsername || '') || undefined
        }));

        return {
            villages: villagesDTO,
            worldSize: this.worldService.getWorldSize()
        };
    }

    @Get('minimap')
    async getMinimap(): Promise<MinimapResponseDTO> {
        const villages = await this.worldService.getAllVillages();
        
        // Look up clan names for each owner
        const ownerUsernames = [...new Set(villages.map(v => v.ownerUsername).filter(Boolean))];
        const users = await this.dbAccessorService.getCollection('users').find({
            username: { $in: ownerUsernames }
        }).project({ username: 1, clanName: 1 }).toArray();
        
        const userClanMap = new Map<string, string>();
        users.forEach((u: any) => {
            if (u.clanName) userClanMap.set(u.username, u.clanName);
        });
        
        const villagesDTO: VillageOnMapDTO[] = villages.map(v => ({
            x: v.x,
            y: v.y,
            ownerUsername: v.ownerUsername || '',
            villageName: v.villageName || '',
            clanName: userClanMap.get(v.ownerUsername || '') || undefined
        }));

        return {
            villages: villagesDTO,
            worldSize: this.worldService.getWorldSize()
        };
    }

    @Post('init')
    async initializeWorld(): Promise<{ success: boolean; message: string }> {
        try {
            await this.worldService.initializeWorld();
            return { success: true, message: 'World initialized' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    @Post('reset')
    async resetWorld(): Promise<{ success: boolean; message: string }> {
        try {
            await this.worldService.resetWorld();
            await this.worldService.initializeWorld();
            return { success: true, message: 'World reset and reinitialized' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    @Post('dev-reset-all')
    async devResetAll(): Promise<{ success: boolean; message: string }> {
        try {
            await this.worldService.devResetAll();
            await this.worldService.initializeWorld();
            return { success: true, message: 'All data reset (users, grids, clans, messages)' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    @Get('available-cells')
    async getAvailableCells(
        @Query('centerX') centerX: string, 
        @Query('centerY') centerY: string,
        @Query('range') range: string
    ): Promise<{ x: number; y: number }[]> {
        const x = parseInt(centerX) || 0;
        const y = parseInt(centerY) || 0;
        const r = parseInt(range) || 5;
        
        const cells = await this.worldService.getAvailableCellsNearVillage(x, y, r);
        return cells.map(c => ({ x: c.x, y: c.y }));
    }
}
