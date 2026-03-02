import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { RelicsModule } from '../relics/relics.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AttackController } from './attack/attack.controller';
import { AttackingService } from './services/attacking/attacking.service';
import { MovementService } from './services/movement.service';

@Module({
  controllers: [AttackController],
  providers: [AttackingService, MovementService],
  imports: [DatabaseModule, ReportsModule, AuthModule, RelicsModule, AnnouncementsModule],
  exports: [MovementService],
})
export class AttackingModule {}
