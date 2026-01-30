import { Body, Controller, Post } from '@nestjs/common';
import { WorkersDTO } from '../dtos/workersDTO';
import { WorkersService } from './workers.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';

@Controller('workers')
export class WorkersController {

    constructor(private workersService: WorkersService)
    {

        
    }

    @Post()
    async hireWorkers(@Body() workersDTO: WorkersDTO): Promise<QuestAwareResponse>
    {
        return await this.workersService.hireWorkers(workersDTO);
    }
}
