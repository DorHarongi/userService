import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MessagesController } from './controllers/messages.controller';
import { MessagesService } from './services/messages.service';

@Module({
    imports: [DatabaseModule],
    controllers: [MessagesController],
    providers: [MessagesService],
    exports: [MessagesService]
})
export class MessagesModule {}
