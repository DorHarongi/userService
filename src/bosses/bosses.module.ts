import { Module } from '@nestjs/common';
import { BossController } from './controllers/boss.controller';
import { BossService } from './services/boss.service';
import { DatabaseModule } from '../database/database.module';
import { MessagesModule } from '../messages/messages.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [DatabaseModule, MessagesModule, AuthModule],
    controllers: [BossController],
    providers: [BossService],
    exports: [BossService]
})
export class BossesModule {}
