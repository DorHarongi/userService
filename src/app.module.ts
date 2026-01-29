import { Module } from '@nestjs/common';
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

@Module({
  imports: [UserModule, DatabaseModule, BuildingsModule, TroopsModule, WorkersModule, AttackingModule, ReportsModule, WorldModule, ClansModule, MessagesModule, InteractionsModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
