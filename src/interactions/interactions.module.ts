import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { InteractionsController } from './controllers/interactions.controller';
import { InteractionsService } from './services/interactions.service';
import { WorldModule } from '../world/world.module';
import { MessagesModule } from '../messages/messages.module';
import { BossesModule } from '../bosses/bosses.module';

@Module({
    imports: [DatabaseModule, WorldModule, MessagesModule, forwardRef(() => BossesModule)],
    controllers: [InteractionsController],
    providers: [InteractionsService],
    exports: [InteractionsService]
})
export class InteractionsModule {}
