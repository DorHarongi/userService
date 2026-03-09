import { Module, Global } from '@nestjs/common';
import { ClanQuestService } from './clan-quest.service';
import { ClanQuestController } from './clan-quest.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';

@Global()
@Module({
    imports: [DatabaseModule, AuthModule, ServerModule],
    controllers: [ClanQuestController],
    providers: [ClanQuestService],
    exports: [ClanQuestService],
})
export class ClanQuestModule {}
