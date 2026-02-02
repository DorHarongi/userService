import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { DatabaseModule } from './database/database.module';
import { BuildingsModule } from './buildings/buildings.module';
import { TroopsModule } from './troops/troops.module';
import { WorkersModule } from './workers/workers.module';
import { AttackingModule } from './attacking/attacking.module';
import { ReportsModule } from './reports/reports.module';
import { WorldModule } from './world/world.module';
import { ClansModule } from './clans/clans.module';
import { MessagesModule } from './messages/messages.module';
import { InteractionsModule } from './interactions/interactions.module';
import { AuthModule } from './auth/auth.module';
import { QuestModule } from './quests/quest.module';
import { BossesModule } from './bosses/bosses.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Rate limiting: 100 requests per 60 seconds per IP
    ThrottlerModule.forRoot([{
      ttl: 60000,  // 60 seconds
      limit: 100,  // max 100 requests
    }]),
    UserModule, 
    DatabaseModule, 
    BuildingsModule, 
    TroopsModule, 
    WorkersModule, 
    AttackingModule, 
    ReportsModule, 
    WorldModule, 
    ClansModule, 
    MessagesModule, 
    InteractionsModule, 
    AuthModule, 
    QuestModule,
    BossesModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply rate limiting globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
