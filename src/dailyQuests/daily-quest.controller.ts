import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { DailyQuestService } from './daily-quest.service';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { User } from '../user/models/user.entity';
import { UserDTO } from '../user/dtos/userDTO';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';
import {
    warehouseStorageByLevel,
    scaleQuestReward,
    scaleQuestTarget,
    spearFighterAttackingStat,
    swordFighterAttackingStat,
    axeFighterAttackingStat,
    archerAttackingStat,
    magicianAttackingStat,
    horsemenAttackingStat,
    catapultsAttackingStat,
} from 'utils';

const USERS_COLLECTION = 'users';

interface ClaimDailyQuestDTO {
    questId: string;
    villageIndex: number;
}

interface DailyQuestWithProgress {
    quest: {
        id: string;
        title: string;
        description: string;
        target: number;
        reward: { wood: number; stone: number; crop: number };
    };
    progress: number;
    claimed: boolean;
}

interface TodayQuestsResponse {
    quests: DailyQuestWithProgress[];
    isAvailable: boolean;
}

@Controller('daily-quests')
@UseGuards(AuthGuard, ServerStatusGuard)
export class DailyQuestController {
    constructor(
        private dailyQuestService: DailyQuestService,
        private dbAccessorService: DbAccessorService,
    ) {}

    @Get('today')
    async getTodaysQuests(@Request() req: any): Promise<TodayQuestsResponse> {
        const username = req.user.username;
        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;

        if (!user) {
            return { quests: [], isAvailable: false };
        }

        const isAvailable = this.dailyQuestService.isDailyQuestAvailable(user);
        if (!isAvailable) {
            return {
                quests: [],
                isAvailable: false,
            };
        }

        const quests = this.dailyQuestService.getTodaysQuests();
        const progress = this.dailyQuestService.getPlayerDailyProgress(user);

        const village = user.villages[0];
        const lowestWarehouse = village ? Math.min(
            warehouseStorageByLevel[village.buildingsLevels.woodWarehouseLevel] || 5000,
            warehouseStorageByLevel[village.buildingsLevels.stoneWarehouseLevel] || 5000,
            warehouseStorageByLevel[village.buildingsLevels.cropWarehouseLevel] || 5000,
        ) : 5000;

        let totalAttackPower = 0;
        let totalPopulation = 0;
        for (const v of user.villages) {
            const t = v.troops;
            totalAttackPower +=
                (t.spearFighters || 0) * spearFighterAttackingStat +
                (t.swordFighters || 0) * swordFighterAttackingStat +
                (t.axeFighters || 0) * axeFighterAttackingStat +
                (t.archers || 0) * archerAttackingStat +
                (t.magicians || 0) * magicianAttackingStat +
                (t.horsemen || 0) * horsemenAttackingStat +
                (t.catapults || 0) * catapultsAttackingStat;
            totalPopulation += v.population || 0;
        }

        const questsWithProgress: DailyQuestWithProgress[] = quests.map((quest, idx) => {
            const scaledTarget = scaleQuestTarget(quest.target, quest.trackingType, totalAttackPower, totalPopulation, user.villages.length);
            const formattedTarget = scaledTarget.toLocaleString('en-US');
            let description = quest.description.replace('{target}', formattedTarget);
            if (quest.targetLabel) {
                description = description.replace('{target_label}', scaledTarget === 1 ? quest.targetLabel[0] : quest.targetLabel[1]);
            }
            return {
                quest: {
                    id: quest.id,
                    title: quest.title,
                    description,
                    target: scaledTarget,
                    reward: scaleQuestReward(quest.reward, lowestWarehouse),
                },
                progress: progress[idx]?.progress ?? 0,
                claimed: progress[idx]?.claimed ?? false,
            };
        });

        return {
            quests: questsWithProgress,
            isAvailable: true,
        };
    }

    @Post('claim')
    async claimDailyQuest(
        @Request() req: any,
        @Body() dto: ClaimDailyQuestDTO,
    ): Promise<{ user: UserDTO | null }> {
        const username = req.user.username;
        const user = await this.dailyQuestService.claimDailyQuest(
            username,
            dto.questId,
            dto.villageIndex,
        );
        return { user: user ? new UserDTO(user) : null };
    }
}
