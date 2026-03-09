import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';
import { ReportsModule } from '../reports/reports.module';
import { MessagesModule } from '../messages/messages.module';
import { OasisController } from './oasis.controller';
import { OasisService } from './oasis.service';

@Module({
    imports: [
        ScheduleModule,
        DatabaseModule,
        AuthModule,
        ServerModule,
        ReportsModule,
        MessagesModule,
    ],
    controllers: [OasisController],
    providers: [OasisService],
    exports: [OasisService],
})
export class OasisModule {}
