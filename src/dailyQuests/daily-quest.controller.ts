import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { DailyQuestService } from './daily-quest.service';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { User } from '../user/models/user.entity';
import { UserDTO } from '../user/dtos/userDTO';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';

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

        const questsWithProgress: DailyQuestWithProgress[] = quests.map((quest, idx) => ({
            quest: {
                id: quest.id,
                title: quest.title,
                description: quest.description,
                target: quest.target,
                reward: quest.reward,
            },
            progress: progress[idx]?.progress ?? 0,
            claimed: progress[idx]?.claimed ?? false,
        }));

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
