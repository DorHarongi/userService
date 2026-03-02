import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { ScoutingService } from './scouting.service';
import { AuthGuard } from '../auth/guards/auth.guard';

interface ScoutDTO {
    attackerVillageName: string;
    defenderUsername: string;
    defenderVillageName: string;
}

@Controller('scouting')
@UseGuards(AuthGuard)
export class ScoutingController {
    constructor(private scoutingService: ScoutingService) {}

    @Post('scout')
    async scout(@Request() req: any, @Body() dto: ScoutDTO): Promise<{ success: boolean }> {
        const attackerUsername = req.user.username;
        await this.scoutingService.scoutVillage(
            attackerUsername,
            dto.attackerVillageName,
            dto.defenderUsername,
            dto.defenderVillageName,
        );
        return { success: true };
    }
}

