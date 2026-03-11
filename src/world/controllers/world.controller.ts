import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { WorldService } from '../services/world.service';
import { MapWindowRequestDTO, MapWindowResponseDTO, MinimapResponseDTO, VillageOnMapDTO, BossOnMapDTO } from '../dtos/mapWindowDTO';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { IBoss } from '../../bosses/models/boss.entity';
import { BOSS_CLAIM_DURATION_MS, BOSS_UNCLAIMED_DESPAWN_MS, RELIC_NAMES } from 'utils';
import { Oasis } from '../../oasis/models/oasis.entity';

@Controller('world')
export class WorldController {
    constructor(
        private worldService: WorldService,
        private dbAccessorService: DbAccessorService
    ) {}

    @Get('map')
    async getMapWindow(
        @Query('startX') startX: string,
        @Query('startY') startY: string,
        @Query('username') currentUsername?: string,
    ): Promise<MapWindowResponseDTO> {
        const x = parseInt(startX) || 0;
        const y = parseInt(startY) || 0;
        
        const villages = await this.worldService.getVillagesInWindow(x, y);
        
        const ownerUsernames = [...new Set(villages.map(v => v.ownerUsername).filter(Boolean))];
        const users = await this.dbAccessorService.getCollection('users').find({
            username: { $in: ownerUsernames }
        }).project({ username: 1, clanName: 1, villages: { villageName: 1, location: 1, buildingsLevels: { quartersLevel: 1 } } }).toArray();
        
        const userClanMap = new Map<string, string>();
        const villageQuartersMap = new Map<string, number>(); // key: "x,y"
        users.forEach((u: any) => {
            if (u.clanName) userClanMap.set(u.username, u.clanName);
            for (const v of u.villages || []) {
                const loc = v.location;
                if (loc && loc.x != null && loc.y != null) {
                    const q = v.buildingsLevels?.quartersLevel ?? 1;
                    villageQuartersMap.set(`${loc.x},${loc.y}`, q);
                }
            }
        });
        
        const villagesDTO: VillageOnMapDTO[] = villages.map(v => ({
            x: v.x,
            y: v.y,
            ownerUsername: v.ownerUsername || '',
            villageName: v.villageName || '',
            clanName: userClanMap.get(v.ownerUsername || '') || undefined,
            quartersLevel: villageQuartersMap.get(`${v.x},${v.y}`) ?? 1
        }));

        // Get bosses in the window
        const bosses = await this.dbAccessorService.getCollection('bosses').find({
            isDefeated: false,
            x: { $gte: x, $lt: x + 10 },
            y: { $gte: y, $lt: y + 10 }
        }).toArray() as IBoss[];

        const bossesDTO: BossOnMapDTO[] = bosses.map(b => this.mapBossToDTO(b));

        const oases = await this.dbAccessorService.getCollection('oases').find({
            x: { $gte: x, $lt: x + 10 },
            y: { $gte: y, $lt: y + 10 },
        }).toArray() as Oasis[];

        let currentUserClan: string | null = null;
        let clanMembers: string[] = [];
        if (currentUsername) {
            const currentUser = await this.dbAccessorService.getCollection('users').findOne(
                { username: currentUsername },
                { projection: { clanName: 1 } },
            ) as any;
            if (currentUser?.clanName) {
                currentUserClan = currentUser.clanName;
                const clan = await this.dbAccessorService.getCollection('clans').findOne(
                    { clanName: currentUserClan },
                    { projection: { members: 1 } },
                ) as any;
                clanMembers = clan?.members || [];
            }
        }

        const oasesDTO = oases.map(o => {
            const dto: any = { id: o._id?.toHexString() || '', x: o.x, y: o.y, tier: o.tier };
            if (o.garrison && currentUsername) {
                if (o.garrison.username === currentUsername) {
                    dto.ownerType = 'mine';
                } else if (currentUserClan && clanMembers.includes(o.garrison.username)) {
                    dto.ownerType = 'clan';
                }
            }
            return dto;
        });

        return {
            villages: villagesDTO,
            bosses: bossesDTO,
            oases: oasesDTO,
            worldSize: this.worldService.getWorldSize()
        };
    }

    @Get('minimap')
    async getMinimap(@Query('username') currentUsername?: string): Promise<MinimapResponseDTO> {
        const villages = await this.worldService.getAllVillages();
        
        const ownerUsernames = [...new Set(villages.map(v => v.ownerUsername).filter(Boolean))];
        const users = await this.dbAccessorService.getCollection('users').find({
            username: { $in: ownerUsernames }
        }).project({ username: 1, clanName: 1, villages: { villageName: 1, location: 1, buildingsLevels: { quartersLevel: 1 } } }).toArray();
        
        const userClanMap = new Map<string, string>();
        const villageQuartersMap = new Map<string, number>();
        users.forEach((u: any) => {
            if (u.clanName) userClanMap.set(u.username, u.clanName);
            for (const v of u.villages || []) {
                const loc = v.location;
                if (loc && loc.x != null && loc.y != null) {
                    const q = v.buildingsLevels?.quartersLevel ?? 1;
                    villageQuartersMap.set(`${loc.x},${loc.y}`, q);
                }
            }
        });
        
        const villagesDTO: VillageOnMapDTO[] = villages.map(v => ({
            x: v.x,
            y: v.y,
            ownerUsername: v.ownerUsername || '',
            villageName: v.villageName || '',
            clanName: userClanMap.get(v.ownerUsername || '') || undefined,
            quartersLevel: villageQuartersMap.get(`${v.x},${v.y}`) ?? 1
        }));

        // Get all active bosses for minimap
        const bosses = await this.dbAccessorService.getCollection('bosses').find({
            isDefeated: false
        }).toArray() as IBoss[];

        const bossesDTO: BossOnMapDTO[] = bosses.map(b => this.mapBossToDTO(b));

        const allOases = await this.dbAccessorService.getCollection('oases').find({}).toArray() as Oasis[];

        let minimapUserClan: string | null = null;
        let minimapClanMembers: string[] = [];
        if (currentUsername) {
            const currentUser = await this.dbAccessorService.getCollection('users').findOne(
                { username: currentUsername },
                { projection: { clanName: 1 } },
            ) as any;
            if (currentUser?.clanName) {
                minimapUserClan = currentUser.clanName;
                const clan = await this.dbAccessorService.getCollection('clans').findOne(
                    { clanName: minimapUserClan },
                    { projection: { members: 1 } },
                ) as any;
                minimapClanMembers = clan?.members || [];
            }
        }

        const oasesDTO = allOases.map(o => {
            const dto: any = { id: o._id?.toHexString() || '', x: o.x, y: o.y, tier: o.tier };
            if (o.garrison && currentUsername) {
                if (o.garrison.username === currentUsername) {
                    dto.ownerType = 'mine';
                } else if (minimapUserClan && minimapClanMembers.includes(o.garrison.username)) {
                    dto.ownerType = 'clan';
                }
            }
            return dto;
        });

        return {
            villages: villagesDTO,
            bosses: bossesDTO,
            oases: oasesDTO,
            worldSize: this.worldService.getWorldSize()
        };
    }

    private mapBossToDTO(boss: IBoss): BossOnMapDTO {
        let expiresAt: Date | undefined;
        if (boss.claimedAt) {
            expiresAt = new Date(new Date(boss.claimedAt).getTime() + BOSS_CLAIM_DURATION_MS);
        } else {
            expiresAt = new Date(new Date(boss.spawnedAt).getTime() + BOSS_UNCLAIMED_DESPAWN_MS);
        }

        const dto: BossOnMapDTO = {
            id: boss._id?.toHexString() || '',
            x: boss.x,
            y: boss.y,
            tier: boss.tier,
            name: boss.name,
            currentHp: boss.currentHp,
            maxHp: boss.maxHp,
            claimedByClanId: boss.claimedByClanId,
            claimedByClanName: boss.claimedByClanName,
            expiresAt
        };
        if (boss.relicId) {
            dto.relicId = boss.relicId;
            const def = RELIC_NAMES.find((r) => r.id === boss.relicId);
            dto.relicName = def?.name ?? boss.relicId;
        }
        return dto;
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
    ): Promise<{ x: number; y: number; hasBoss?: boolean }[]> {
        const x = parseInt(centerX) || 0;
        const y = parseInt(centerY) || 0;
        const r = parseInt(range) || 5;
        
        const cells = await this.worldService.getAvailableCellsNearVillage(x, y, r);
        
        // Get bosses in the area to mark cells with bosses
        const bosses = await this.dbAccessorService.getCollection('bosses').find({
            isDefeated: false,
            x: { $gte: x - r, $lte: x + r },
            y: { $gte: y - r, $lte: y + r }
        }).toArray() as IBoss[];
        
        const bossLocations = new Set(bosses.map(b => `${b.x},${b.y}`));
        
        return cells.map(c => ({
            x: c.x,
            y: c.y,
            hasBoss: bossLocations.has(`${c.x},${c.y}`)
        }));
    }
}
