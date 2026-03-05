import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ServerModule } from '../server/server.module';
import { WorkersController } from './workers/workers.controller';
import { WorkersService } from './workers/workers.service';

@Module({
  controllers: [WorkersController],
  providers: [WorkersService],
  imports: [DatabaseModule, AuthModule, ServerModule]
})
export class WorkersModule {}
