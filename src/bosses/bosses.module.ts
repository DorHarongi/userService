import { Module } from '@nestjs/common';
import { BossController } from './controllers/boss.controller';
import { BossService } from './services/boss.service';
import { DatabaseModule } from '../database/database.module';
import { MessagesModule } from '../messages/messages.module';
import { AuthModule } from '../auth/auth.module';
import { RelicsModule } from '../relics/relics.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { ServerModule } from '../server/server.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
    imports: [DatabaseModule, MessagesModule, AuthModule, RelicsModule, AnnouncementsModule, ServerModule, ReportsModule],
    controllers: [BossController],
    providers: [BossService],
    exports: [BossService]
})
export class BossesModule {}
