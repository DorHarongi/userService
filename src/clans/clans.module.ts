import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MessagesModule } from '../messages/messages.module';
import { ClansController } from './controllers/clans.controller';
import { ClansService } from './services/clans.service';

@Module({
    imports: [DatabaseModule, MessagesModule],
    controllers: [ClansController],
    providers: [ClansService],
    exports: [ClansService]
})
export class ClansModule {}
