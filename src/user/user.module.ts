import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UserRepositoryService } from './services/user-repository.service';
import { InactiveCleanupService } from './services/inactive-cleanup.service';
import { UserController } from './controllers/user.controller';
import { WorldModule } from '../world/world.module';
import { AuthModule } from '../auth/auth.module';
import { AttackingModule } from '../attacking/attacking.module';
import { ServerModule } from '../server/server.module';
import { ClansModule } from '../clans/clans.module';
import { RelicsModule } from '../relics/relics.module';
@Module({
  imports: [DatabaseModule, forwardRef(() => WorldModule), AuthModule, AttackingModule, ServerModule, forwardRef(() => ClansModule), RelicsModule],
  controllers: [UserController],
  providers: [UserRepositoryService, InactiveCleanupService],
  exports: [UserRepositoryService]
})
export class UserModule {}
