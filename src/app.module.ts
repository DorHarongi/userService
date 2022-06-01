import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { DatabaseModule } from './database/database.module';
import { BuildingsModule } from './buildings/buildings.module';

@Module({
  imports: [UserModule, DatabaseModule, BuildingsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
