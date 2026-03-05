import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';
import { TroopsTrainingService } from './troops-training/services/troops-training-service/troops-training.service';
import { TroopsTrainingController } from './troops-training/troops-training.controller';

@Module({
  controllers: [TroopsTrainingController],
  providers: [TroopsTrainingService],
  imports: [DatabaseModule, AuthModule, ServerModule]
})
export class TroopsModule {}
