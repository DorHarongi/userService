import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { BuildingsUpgradingController } from './buildings-upgrading/buildings-upgrading.controller';
import { BuildingsUpgradingService } from './services/buildings-upgrading/buildings-upgrading.service';

@Module({
  controllers: [BuildingsUpgradingController],
  providers: [BuildingsUpgradingService],
  imports: [DatabaseModule, AuthModule]
})
export class BuildingsModule {}
