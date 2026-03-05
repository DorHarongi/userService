import { Module } from '@nestjs/common';
import { ServerController } from './server.controller';
import { ServerService } from './server.service';
import { ServerStatusGuard } from './server-status.guard';
import { DatabaseModule } from '../database/database.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AnnouncementsModule, AuthModule],
  controllers: [ServerController],
  providers: [ServerService, ServerStatusGuard],
  exports: [ServerService, ServerStatusGuard],
})
export class ServerModule {}
