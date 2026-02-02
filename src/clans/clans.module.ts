import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { ClansController } from './controllers/clans.controller';
import { ClansService } from './services/clans.service';

@Module({
    imports: [DatabaseModule, MessagesModule, AuthModule],
    controllers: [ClansController],
    providers: [ClansService],
    exports: [ClansService]
})
export class ClansModule {}
