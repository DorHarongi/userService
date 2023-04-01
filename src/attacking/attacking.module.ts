import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { DatabaseModule } from '../database/database.module';
import { AttackController } from './attack/attack.controller';
import { AttackingService } from './services/attacking/attacking.service';

@Module({
  controllers: [AttackController],
  providers: [AttackingService],
  imports: [DatabaseModule, ReportsModule]
})
export class AttackingModule {}
