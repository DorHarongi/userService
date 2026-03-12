import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ClanQuestService, ClanQuestStatusResponse } from './clan-quest.service';
import { UserDTO } from '../user/dtos/userDTO';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';
import { warehouseStorageByLevel, scaleQuestReward } from 'utils';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { User } from '../user/models/user.entity';

interface ClaimClanQuestDTO {
    villageIndex: number;
}

@Controller('clan-quests')
@UseGuards(AuthGuard, ServerStatusGuard)
export class ClanQuestController {
    constructor(
        private clanQuestService: ClanQuestService,
        private dbAccessorService: DbAccessorService,
    ) {}

    @Get('status')
    async getClanQuestStatus(@Request() req: any): Promise<ClanQuestStatusResponse | null> {
        const username = req.user.username;
        const status = await this.clanQuestService.getClanQuestStatus(username);
        if (!status) return null;

        const user = (await this.dbAccessorService
            .getCollection('users')
            .findOne({ username })) as User;
        if (user?.villages?.[0]) {
            const v = user.villages[0];
            const lowestWarehouse = Math.min(
                warehouseStorageByLevel[v.buildingsLevels.woodWarehouseLevel] || 5000,
                warehouseStorageByLevel[v.buildingsLevels.stoneWarehouseLevel] || 5000,
                warehouseStorageByLevel[v.buildingsLevels.cropWarehouseLevel] || 5000,
            );
            status.quest = {
                ...status.quest,
                description: status.quest.description.replace('{target}', status.quest.target.toLocaleString('en-US')),
                reward: scaleQuestReward(status.quest.reward, lowestWarehouse),
            };
        } else {
            status.quest = {
                ...status.quest,
                description: status.quest.description.replace('{target}', status.quest.target.toLocaleString('en-US')),
            };
        }

        return status;
    }

    @Post('claim')
    async claimClanQuest(
        @Request() req: any,
        @Body() dto: ClaimClanQuestDTO,
    ): Promise<{ user: UserDTO | null }> {
        const username = req.user.username;
        const user = await this.clanQuestService.claimClanQuestReward(
            username,
            dto.villageIndex,
        );
        return { user: user ? new UserDTO(user) : null };
    }
}
