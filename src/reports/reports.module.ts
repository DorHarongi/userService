import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './controllers/reports/reports.controller';
import { ReportsService } from './services/reports/reports.service';

@Module({
  providers: [ReportsService],
  controllers: [ReportsController],
  imports: [DatabaseModule, AuthModule],
  exports: [ReportsService]
})
export class ReportsModule {}
