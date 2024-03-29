import { Controller, Get, Param } from '@nestjs/common';
import { AttackReportToClientDTO } from '../../models/attackReportToClientDTO';
import { ReportsService } from '../../services/reports/reports.service';

@Controller('reports')
export class ReportsController {

    constructor(private reportsService: ReportsService){ }

    @Get('attackReports/:username/:page')
    async getAttackReports(@Param('username') username: string, @Param('page') page: number): Promise<AttackReportToClientDTO[]>
    {
        return await this.reportsService.getAttackReportsOfUser(username, page);
    }
}
