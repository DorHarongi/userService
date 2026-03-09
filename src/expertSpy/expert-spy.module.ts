import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';
import { MessagesModule } from '../messages/messages.module';
import { ReportsModule } from '../reports/reports.module';
import { ExpertSpyService } from './expert-spy.service';
import { ExpertSpyController } from './expert-spy.controller';

@Global()
@Module({
    imports: [
        DatabaseModule,
        AuthModule,
        ScheduleModule.forRoot(),
        ServerModule,
        MessagesModule,
        ReportsModule,
    ],
    providers: [ExpertSpyService],
    controllers: [ExpertSpyController],
    exports: [ExpertSpyService],
})
export class ExpertSpyModule {}
