import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UserRepositoryService } from './services/user-repository.service';
import { UserController } from './controllers/user.controller';
import { WorldModule } from '../world/world.module';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [DatabaseModule, forwardRef(() => WorldModule), AuthModule],
  controllers: [UserController],
  providers: [UserRepositoryService],
  exports: [UserRepositoryService]
})
export class UserModule {}
