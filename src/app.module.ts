import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { DatabaseModule } from './database/database.module';
import { BuildingsModule } from './buildings/buildings.module';
import { TroopsModule } from './troops/troops.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [UserModule, DatabaseModule, BuildingsModule, TroopsModule, WorkersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
