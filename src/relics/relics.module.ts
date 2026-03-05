import { Module } from '@nestjs/common';
import { RelicsController } from './relics.controller';
import { RelicsService } from './relics.service';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { ServerModule } from '../server/server.module';

@Module({
  imports: [DatabaseModule, AuthModule, AnnouncementsModule, ServerModule],
  controllers: [RelicsController],
  providers: [RelicsService],
  exports: [RelicsService],
})
export class RelicsModule {}
