import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AttackController } from './attack/attack.controller';
import { AttackingService } from './services/attacking/attacking.service';

@Module({
  controllers: [AttackController],
  providers: [AttackingService],
  imports: [DatabaseModule]
})
export class AttackingModule {}
