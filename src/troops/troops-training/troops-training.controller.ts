import { Body, Controller, Post } from '@nestjs/common';
import { UserDTO } from '../../user/dtos/userDTO';
import { TrainDTO } from '../dtos/trainDTO';
import { TroopsTrainingService } from './services/troops-training-service/troops-training.service';


@Controller('troops-training')
export class TroopsTrainingController {
    constructor(private troopsTrainingService: TroopsTrainingService) {}
    
    @Post()
    async troopsTraining(@Body() trainDTO: TrainDTO): Promise<UserDTO>
    {
        return await this.troopsTrainingService.trainTroops(trainDTO);
    }
}
