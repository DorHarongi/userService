import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { WorkersDTO } from '../dtos/workersDTO';
import { WorkersService } from './workers.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';
import { AuthGuard } from '../../auth/guards/auth.guard';

@Controller('workers')
@UseGuards(AuthGuard)
export class WorkersController {

    constructor(private workersService: WorkersService)
    {

        
    }

    @Post()
    async hireWorkers(@Request() req: any, @Body() workersDTO: WorkersDTO): Promise<QuestAwareResponse>
    {
        // Use authenticated username instead of trusting DTO
        workersDTO.username = req.user.username;
        return await this.workersService.hireWorkers(workersDTO);
    }
}
