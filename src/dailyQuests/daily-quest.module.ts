import { Module, Global } from '@nestjs/common';
import { DailyQuestService } from './daily-quest.service';
import { DailyQuestController } from './daily-quest.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';

@Global()
@Module({
    imports: [DatabaseModule, AuthModule, ServerModule],
    controllers: [DailyQuestController],
    providers: [DailyQuestService],
    exports: [DailyQuestService],
})
export class DailyQuestModule {}
