import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { ReportsModule } from '../reports/reports.module';
import { ScoutingService } from './scouting.service';
import { ScoutingController } from './scouting.controller';

@Module({
    imports: [
        DatabaseModule,
        ReportsModule,
        ScheduleModule.forRoot(),
    ],
    providers: [ScoutingService],
    controllers: [ScoutingController],
})
export class ScoutingModule {}

