import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkersController } from './workers/workers.controller';
import { WorkersService } from './workers/workers.service';

@Module({
  controllers: [WorkersController],
  providers: [WorkersService],
  imports: [DatabaseModule]
})
export class WorkersModule {}
