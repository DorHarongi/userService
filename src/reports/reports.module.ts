import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReportsController } from './controllers/reports/reports.controller';
import { ReportsService } from './services/reports/reports.service';

@Module({
  providers: [ReportsService],
  controllers: [ReportsController],
  imports: [DatabaseModule],
  exports: [ReportsService]
})
export class ReportsModule {}
