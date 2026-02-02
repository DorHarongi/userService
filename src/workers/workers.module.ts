import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { WorkersController } from './workers/workers.controller';
import { WorkersService } from './workers/workers.service';

@Module({
  controllers: [WorkersController],
  providers: [WorkersService],
  imports: [DatabaseModule, AuthModule]
})
export class WorkersModule {}
