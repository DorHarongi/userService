import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';
import { ReportsModule } from '../reports/reports.module';
import { MessagesModule } from '../messages/messages.module';
import { ScoutingModule } from '../scouting/scouting.module';
import { OasisController } from './oasis.controller';
import { OasisService } from './oasis.service';

@Module({
    imports: [
        DatabaseModule,
        AuthModule,
        ServerModule,
        ReportsModule,
        MessagesModule,
        ScoutingModule,
    ],
    controllers: [OasisController],
    providers: [OasisService],
    exports: [OasisService],
})
export class OasisModule {}
