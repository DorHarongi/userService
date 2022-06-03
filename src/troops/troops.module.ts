import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TroopsTrainingService } from './troops-training/services/troops-training-service/troops-training.service';
import { TroopsTrainingController } from './troops-training/troops-training.controller';

@Module({
  controllers: [TroopsTrainingController],
  providers: [TroopsTrainingService],
  imports: [DatabaseModule]
})
export class TroopsModule {}
