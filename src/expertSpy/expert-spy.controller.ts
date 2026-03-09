import { Body, Controller, Get, Param, Post, UseGuards, Request } from '@nestjs/common';
import { ExpertSpyService } from './expert-spy.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';

interface DeployExpertSpyDTO {
    villageName: string;
    targetUsername?: string;
    targetVillageName?: string;
    targetType: 'village' | 'oasis';
    targetOasisId?: string;
}

@Controller('expert-spy')
@UseGuards(AuthGuard, ServerStatusGuard)
export class ExpertSpyController {
    constructor(private expertSpyService: ExpertSpyService) {}

    @Post('deploy')
    async deploy(
        @Request() req: { user: { username: string } },
        @Body() dto: DeployExpertSpyDTO,
    ): Promise<{ success: boolean; travelTimeMs: number }> {
        const username = req.user.username;
        const travelTimeMs = await this.expertSpyService.deployExpertSpy(
            username,
            dto.villageName,
            dto.targetUsername,
            dto.targetVillageName,
            dto.targetType,
            dto.targetOasisId,
        );
        return { success: true, travelTimeMs };
    }

    @Get('status/:villageName')
    async getStatus(
        @Request() req: { user: { username: string } },
        @Param('villageName') villageName: string,
    ): Promise<{
        status: 'available' | 'deployed' | 'dead';
        targetUsername?: string;
        targetVillageName?: string;
        targetType?: 'village' | 'oasis';
        targetOasisId?: string;
        deployedAt?: Date;
        embedExpiresAt?: Date;
        deathCooldownUntil?: Date;
    }> {
        const username = req.user.username;
        return this.expertSpyService.getExpertSpyStatus(username, villageName);
    }
}
