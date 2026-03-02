import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { RelicsModule } from '../relics/relics.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { ClansController } from './controllers/clans.controller';
import { ClansService } from './services/clans.service';

@Module({
    imports: [DatabaseModule, MessagesModule, AuthModule, RelicsModule, AnnouncementsModule],
    controllers: [ClansController],
    providers: [ClansService],
    exports: [ClansService]
})
export class ClansModule {}
