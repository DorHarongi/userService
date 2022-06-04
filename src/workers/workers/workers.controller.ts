import { Body, Controller, Post } from '@nestjs/common';
import { UserDTO } from '../../user/dtos/userDTO';
import { WorkersDTO } from '../dtos/workersDTO';
import { WorkersService } from './workers.service';

@Controller('workers')
export class WorkersController {

    constructor(private workersService: WorkersService)
    {

        
    }

    @Post()
    async hireWorkers(@Body() workersDTO: WorkersDTO): Promise<UserDTO>
    {
        return await this.workersService.hireWorkers(workersDTO);
    }
}
