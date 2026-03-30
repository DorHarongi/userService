import { Module, forwardRef } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { RelicsModule } from '../relics/relics.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { ServerModule } from '../server/server.module';
import { MessagesModule } from '../messages/messages.module';
import { BossesModule } from '../bosses/bosses.module';
import { OasisModule } from '../oasis/oasis.module';
import { ScoutingModule } from '../scouting/scouting.module';
import { AttackController } from './attack/attack.controller';
import { AttackingService } from './services/attacking/attacking.service';
import { MovementService } from './services/movement.service';

@Module({
  controllers: [AttackController],
  providers: [AttackingService, MovementService],
  imports: [DatabaseModule, ReportsModule, AuthModule, RelicsModule, AnnouncementsModule, ServerModule, MessagesModule, forwardRef(() => BossesModule), OasisModule, ScoutingModule],
  exports: [MovementService],
})
export class AttackingModule {}
