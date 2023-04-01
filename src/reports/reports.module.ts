import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AttackReportsService } from './services/attack-reports/attack-reports.service';

@Module({
  providers: [AttackReportsService],
  imports: [DatabaseModule],
  exports: [AttackReportsService]
})
export class ReportsModule {}
