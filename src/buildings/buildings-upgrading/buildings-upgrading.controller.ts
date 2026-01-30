import { Body, Controller, Post } from '@nestjs/common';
import { upgradeDTO } from '../dtos/upgradeDTO';
import { BuildingsUpgradingService } from '../services/buildings-upgrading/buildings-upgrading.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';

@Controller('buildings-upgrading')
export class BuildingsUpgradingController {
    constructor(private buildingsUpgradingService: BuildingsUpgradingService){
    }

    @Post('upgradeBuilding')
    async upgradeBuilding(@Body() upgradeDTO: upgradeDTO): Promise<QuestAwareResponse>
    {
        return await this.buildingsUpgradingService.upgradeBuilding(upgradeDTO);
    }
}
