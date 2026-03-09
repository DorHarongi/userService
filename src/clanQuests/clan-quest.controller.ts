import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ClanQuestService, ClanQuestStatusResponse } from './clan-quest.service';
import { UserDTO } from '../user/dtos/userDTO';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';

interface ClaimClanQuestDTO {
    villageIndex: number;
}

@Controller('clan-quests')
@UseGuards(AuthGuard, ServerStatusGuard)
export class ClanQuestController {
    constructor(private clanQuestService: ClanQuestService) {}

    @Get('status')
    async getClanQuestStatus(@Request() req: any): Promise<ClanQuestStatusResponse | null> {
        const username = req.user.username;
        return this.clanQuestService.getClanQuestStatus(username);
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
