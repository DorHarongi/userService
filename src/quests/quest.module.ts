import { Module, Global } from '@nestjs/common';
import { QuestService } from './quest.service';
import { QuestController } from './quest.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
    imports: [DatabaseModule, AuthModule],
    controllers: [QuestController],
    providers: [QuestService],
    exports: [QuestService]
})
export class QuestModule {}
