import { Controller, Post, Body } from '@nestjs/common';
import { QuestService } from './quest.service';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { User } from '../user/models/user.entity';
import { UserDTO } from '../user/dtos/userDTO';
import { QuestAwareResponse } from './quest-response.dto';

const USERS_COLLECTION = "users";

interface ClaimQuestDTO {
    username: string;
}

interface QuestStatusResponse {
    isClaimable: boolean;
    user: UserDTO;
}

@Controller('quests')
export class QuestController {
    constructor(
        private questService: QuestService,
        private dbAccessorService: DbAccessorService
    ) {}

    /**
     * Check if current quest is claimable (conditions already met)
     */
    @Post('status')
    async getQuestStatus(@Body() dto: ClaimQuestDTO): Promise<QuestStatusResponse> {
        const user = await this.dbAccessorService.getCollection(USERS_COLLECTION)
            .findOne({ username: dto.username }) as User;

        if (!user) {
            return { isClaimable: false, user: null as any };
        }

        const isClaimable = this.questService.isCurrentQuestClaimable(user);
        return { isClaimable, user: new UserDTO(user) };
    }

    /**
     * Claim rewards for a quest that was already completed before reaching it
     */
    @Post('claim')
    async claimQuest(@Body() dto: ClaimQuestDTO): Promise<QuestAwareResponse> {
        const user = await this.dbAccessorService.getCollection(USERS_COLLECTION)
            .findOne({ username: dto.username }) as User;

        if (!user) {
            return { user: null as any, questCompleted: null };
        }

        const questCompleted = this.questService.claimCompletedQuest(user);

        if (questCompleted) {
            // Save updated user
            await this.dbAccessorService.getCollection(USERS_COLLECTION)
                .updateOne({ username: dto.username }, { $set: user });
        }

        return { user: new UserDTO(user), questCompleted };
    }
}
