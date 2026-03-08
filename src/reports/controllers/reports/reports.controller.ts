import { Body, Controller, Get, Param, Post, UseGuards, Request } from '@nestjs/common';
import { AttackReportToClientDTO } from '../../models/attackReportToClientDTO';
import { ReportsService } from '../../services/reports/reports.service';
import { AuthGuard } from '../../../auth/guards/auth.guard';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {

    constructor(private reportsService: ReportsService){ }

    @Get('attackReports/:username')
    async getNumberOfAttackReportPages(@Request() req: any, @Param('username') username: string): Promise<number>
    {
        // Verify user can only access their own reports
        if (req.user.username !== username) {
            return 0;
        }
        return await this.reportsService.getNumberOfAttackReportPages(username);
    }

    @Get('attackReports/:username/:page')
    async getAttackReports(@Request() req: any, @Param('username') username: string, @Param('page') page: number): Promise<AttackReportToClientDTO[]>
    {
        // Verify user can only access their own reports
        if (req.user.username !== username) {
            return [];
        }
        return await this.reportsService.getAttackReportsOfUser(username, page);
    }

    @Get('unread/:username')
    async getUnreadReportCount(@Request() req: any, @Param('username') username: string): Promise<number>
    {
        // Verify user can only access their own reports
        if (req.user.username !== username) {
            return 0;
        }
        return await this.reportsService.getUnreadReportCount(username);
    }

    @Post('read')
    async markReportAsRead(@Request() req: any, @Body() body: { reportId: string; username: string }): Promise<{ success: boolean }>
    {
        // Use authenticated username
        return await this.reportsService.markReportAsRead(body.reportId, req.user.username);
    }
}
