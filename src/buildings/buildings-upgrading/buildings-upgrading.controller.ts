import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { upgradeDTO } from '../dtos/upgradeDTO';
import { BuildingsUpgradingService } from '../services/buildings-upgrading/buildings-upgrading.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';
import { AuthGuard } from '../../auth/guards/auth.guard';

@Controller('buildings-upgrading')
@UseGuards(AuthGuard)
export class BuildingsUpgradingController {
    constructor(private buildingsUpgradingService: BuildingsUpgradingService){
    }

    @Post('upgradeBuilding')
    async upgradeBuilding(@Request() req: any, @Body() upgradeDTO: upgradeDTO): Promise<QuestAwareResponse>
    {
        // Use authenticated username instead of trusting DTO
        upgradeDTO.username = req.user.username;
        return await this.buildingsUpgradingService.upgradeBuilding(upgradeDTO);
    }
}
