import { Module, Global } from '@nestjs/common';
import { QuestService } from './quest.service';
import { QuestController } from './quest.controller';
import { DatabaseModule } from '../database/database.module';

@Global()
@Module({
    imports: [DatabaseModule],
    controllers: [QuestController],
    providers: [QuestService],
    exports: [QuestService]
})
export class QuestModule {}
