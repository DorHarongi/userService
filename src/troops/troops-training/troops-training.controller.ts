import { Body, Controller, Post } from '@nestjs/common';
import { TrainDTO } from '../dtos/trainDTO';
import { TroopsTrainingService } from './services/troops-training-service/troops-training.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';


@Controller('troops-training')
export class TroopsTrainingController {
    constructor(private troopsTrainingService: TroopsTrainingService) {}
    
    @Post()
    async troopsTraining(@Body() trainDTO: TrainDTO): Promise<QuestAwareResponse>
    {
        return await this.troopsTrainingService.trainTroops(trainDTO);
    }
}
