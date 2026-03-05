import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';
import { MessagesController } from './controllers/messages.controller';
import { MessagesService } from './services/messages.service';

// Messages module.
@Module({
    imports: [DatabaseModule, AuthModule, ServerModule],
    controllers: [MessagesController],
    providers: [MessagesService],
    exports: [MessagesService]
})
export class MessagesModule {}
