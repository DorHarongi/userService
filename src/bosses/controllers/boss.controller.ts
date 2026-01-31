import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { BossService } from '../services/boss.service';
import { AttackBossDTO, BossAttackResultDTO, BossDTO, RaidReportDTO } from '../dtos/bossDTO';

@Controller('bosses')
@UseGuards(AuthGuard)
export class BossController {
    constructor(private bossService: BossService) {}

    // Get all active bosses (for map display)
    @Get()
    async getAllBosses(): Promise<BossDTO[]> {
        return this.bossService.getAllActiveBosses();
    }

    // Get specific boss details
    @Get(':bossId')
    async getBoss(@Param('bossId') bossId: string): Promise<BossDTO | null> {
        return this.bossService.getBossById(bossId);
    }

    // Check if a cell has a boss (for village creation validation)
    @Get('cell/:x/:y')
    async checkCellForBoss(
        @Param('x') x: string,
        @Param('y') y: string
    ): Promise<{ hasBoss: boolean }> {
        const hasBoss = await this.bossService.isCellOccupiedByBoss(
            parseInt(x, 10),
            parseInt(y, 10)
        );
        return { hasBoss };
    }

    // Attack a boss
    @Post('attack/:username')
    async attackBoss(
        @Param('username') username: string,
        @Body() dto: AttackBossDTO
    ): Promise<BossAttackResultDTO> {
        return this.bossService.attackBoss(username, dto);
    }

    // Get raid reports for a user
    @Get('reports/:username/:page')
    async getRaidReports(
        @Param('username') username: string,
        @Param('page') page: string
    ): Promise<RaidReportDTO[]> {
        return this.bossService.getRaidReports(username, parseInt(page, 10));
    }

    // Get raid report page count
    @Get('reports/:username')
    async getRaidReportPageCount(
        @Param('username') username: string
    ): Promise<{ pages: number }> {
        const pages = await this.bossService.getRaidReportPageCount(username);
        return { pages };
    }

    // Get unread raid report count
    @Get('reports/unread/:username')
    async getUnreadRaidReportCount(
        @Param('username') username: string
    ): Promise<{ count: number }> {
        const count = await this.bossService.getUnreadRaidReportCount(username);
        return { count };
    }

    // Mark raid report as read
    @Post('reports/read/:reportId/:username')
    async markRaidReportAsRead(
        @Param('reportId') reportId: string,
        @Param('username') username: string
    ): Promise<{ success: boolean }> {
        await this.bossService.markRaidReportAsRead(reportId, username);
        return { success: true };
    }

    // Get pending boss rewards for a user
    @Get('rewards/pending/:username')
    async getPendingRewards(
        @Param('username') username: string
    ): Promise<{ bossName: string; defeatedAt: Date; rewards: { wood: number; stone: number; crop: number } }[]> {
        return this.bossService.getPendingRewards(username);
    }

    // Claim a boss reward
    @Post('rewards/claim/:username/:rewardIndex')
    async claimBossReward(
        @Param('username') username: string,
        @Param('rewardIndex') rewardIndex: string
    ): Promise<{ success: boolean; rewards?: { wood: number; stone: number; crop: number } }> {
        return this.bossService.claimBossReward(username, parseInt(rewardIndex, 10));
    }
}
