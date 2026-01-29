import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorldController } from './controllers/world.controller';
import { WorldService } from './services/world.service';

@Module({
    imports: [DatabaseModule],
    controllers: [WorldController],
    providers: [WorldService],
    exports: [WorldService]
})
export class WorldModule {}
