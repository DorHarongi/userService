import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { ScoutingService } from './scouting.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';

interface ScoutDTO {
    attackerVillageName: string;
    defenderUsername: string;
    defenderVillageName: string;
}

@Controller('scouting')
@UseGuards(AuthGuard, ServerStatusGuard)
export class ScoutingController {
    constructor(private scoutingService: ScoutingService) {}

    @Post('scout')
    async scout(@Request() req: any, @Body() dto: ScoutDTO): Promise<{ success: boolean; travelTimeMs: number }> {
        const attackerUsername = req.user.username;
        const travelTimeMs = await this.scoutingService.scoutVillage(
            attackerUsername,
            dto.attackerVillageName,
            dto.defenderUsername,
            dto.defenderVillageName,
        );
        return { success: true, travelTimeMs };
    }
}

