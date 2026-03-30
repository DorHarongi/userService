import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ReportsModule } from '../reports/reports.module';
import { ServerModule } from '../server/server.module';
import { ScoutingService } from './scouting.service';
import { ScoutingController } from './scouting.controller';

@Module({
    imports: [
        DatabaseModule,
        AuthModule,
        ReportsModule,
        ServerModule,
    ],
    providers: [ScoutingService],
    controllers: [ScoutingController],
})
export class ScoutingModule {}

