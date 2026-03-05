import { Body, Controller, Get, Param, Post, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { ServerStatusGuard } from '../../server/server-status.guard';
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

    @Get('damage-leaderboard/:bossId')
    async getBossDamageLeaderboard(@Param('bossId') bossId: string) {
        return this.bossService.getBossDamageLeaderboard(bossId);
    }

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

    @Post('attack/:username')
    async attackBoss(
        @Request() req: any,
        @Param('username') username: string,
        @Body() dto: AttackBossDTO
    ): Promise<{ travelTimeMs: number }> {
        return this.bossService.attackBoss(req.user.username, dto);
    }

    // Get raid reports for a user
    @Get('reports/:username/:page')
    async getRaidReports(
        @Request() req: any,
        @Param('username') username: string,
        @Param('page') page: string
    ): Promise<RaidReportDTO[]> {
        // Verify user can only access their own reports
        if (req.user.username !== username) {
            return [];
        }
        return this.bossService.getRaidReports(username, parseInt(page, 10));
    }

    // Get raid report page count
    @Get('reports/:username')
    async getRaidReportPageCount(
        @Request() req: any,
        @Param('username') username: string
    ): Promise<{ pages: number }> {
        // Verify user can only access their own reports
        if (req.user.username !== username) {
            return { pages: 0 };
        }
        const pages = await this.bossService.getRaidReportPageCount(username);
        return { pages };
    }

    // Get unread raid report count
    @Get('reports/unread/:username')
    async getUnreadRaidReportCount(
        @Request() req: any,
        @Param('username') username: string
    ): Promise<{ count: number }> {
        // Verify user can only access their own data
        if (req.user.username !== username) {
            return { count: 0 };
        }
        const count = await this.bossService.getUnreadRaidReportCount(username);
        return { count };
    }

    // Mark raid report as read
    @Post('reports/read/:reportId/:username')
    @UseGuards(ServerStatusGuard)
    async markRaidReportAsRead(
        @Request() req: any,
        @Param('reportId') reportId: string,
        @Param('username') username: string
    ): Promise<{ success: boolean }> {
        // Use authenticated username
        await this.bossService.markRaidReportAsRead(reportId, req.user.username);
        return { success: true };
    }

    // Get pending boss rewards for a user
    @Get('rewards/pending/:username')
    async getPendingRewards(
        @Request() req: any,
        @Param('username') username: string
    ): Promise<{ bossName: string; defeatedAt: Date; rewards: { wood: number; stone: number; crop: number } }[]> {
        // Verify user can only access their own rewards
        if (req.user.username !== username) {
            return [];
        }
        return this.bossService.getPendingRewards(username);
    }

    // Claim a boss reward
    @Post('rewards/claim/:username/:rewardIndex')
    @UseGuards(ServerStatusGuard)
    async claimBossReward(
        @Request() req: any,
        @Param('username') username: string,
        @Param('rewardIndex') rewardIndex: string
    ): Promise<{ success: boolean; rewards?: { wood: number; stone: number; crop: number } }> {
        // Use authenticated username
        return this.bossService.claimBossReward(req.user.username, parseInt(rewardIndex, 10));
    }
}
