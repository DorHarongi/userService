import { Module, Global } from '@nestjs/common';
import { QuestService } from './quest.service';

@Global()
@Module({
    providers: [QuestService],
    exports: [QuestService]
})
export class QuestModule {}
