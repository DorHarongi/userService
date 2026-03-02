import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ChatController } from './chat.controller';

@Module({
    imports: [DatabaseModule, AuthModule],
    controllers: [ChatController],
    providers: [ChatGateway, ChatService],
})
export class ChatModule {}

