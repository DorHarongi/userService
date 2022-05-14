import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../src/database/database.module';
import { UserRepositoryService } from './services/user-repository.service';
import { UserController } from './controllers/user.controller';
@Module({
  imports: [DatabaseModule],
  controllers: [UserController],
  providers: [UserRepositoryService]
})
export class UserModule {}
