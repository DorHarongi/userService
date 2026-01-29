import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { WorldService } from '../services/world.service';
import { MapWindowRequestDTO, MapWindowResponseDTO, MinimapResponseDTO, VillageOnMapDTO } from '../dtos/mapWindowDTO';

@Controller('world')
export class WorldController {
    constructor(private worldService: WorldService) {}

    @Get('map')
    async getMapWindow(@Query('startX') startX: string, @Query('startY') startY: string): Promise<MapWindowResponseDTO> {
        const x = parseInt(startX) || 0;
        const y = parseInt(startY) || 0;
        
        const villages = await this.worldService.getVillagesInWindow(x, y);
        const villagesDTO: VillageOnMapDTO[] = villages.map(v => ({
            x: v.x,
            y: v.y,
            ownerUsername: v.ownerUsername || '',
            villageName: v.villageName || ''
        }));

        return {
            villages: villagesDTO,
            worldSize: this.worldService.getWorldSize()
        };
    }

    @Get('minimap')
    async getMinimap(): Promise<MinimapResponseDTO> {
        const villages = await this.worldService.getAllVillages();
        const villagesDTO: VillageOnMapDTO[] = villages.map(v => ({
            x: v.x,
            y: v.y,
            ownerUsername: v.ownerUsername || '',
            villageName: v.villageName || ''
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
