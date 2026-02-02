import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { TrainDTO } from '../dtos/trainDTO';
import { TroopsTrainingService } from './services/troops-training-service/troops-training.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';
import { AuthGuard } from '../../auth/guards/auth.guard';

@Controller('troops-training')
@UseGuards(AuthGuard)
export class TroopsTrainingController {
    constructor(private troopsTrainingService: TroopsTrainingService) {}
    
    @Post()
    async troopsTraining(@Request() req: any, @Body() trainDTO: TrainDTO): Promise<QuestAwareResponse>
    {
        // Use authenticated username instead of trusting DTO
        trainDTO.username = req.user.username;
        return await this.troopsTrainingService.trainTroops(trainDTO);
    }
}
