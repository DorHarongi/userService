import { Body, Controller, Post } from '@nestjs/common';
import { UserDTO } from '../../user/dtos/userDTO';
import { upgradeDTO } from '../dtos/upgradeDTO';
import { BuildingsUpgradingService } from '../services/buildings-upgrading/buildings-upgrading.service';

@Controller('buildings-upgrading')
export class BuildingsUpgradingController {
    constructor(private buildingsUpgradingService: BuildingsUpgradingService){
    }

    @Post('upgradeBuilding')
    async upgradeBuilding(@Body() upgradeDTO: upgradeDTO): Promise<UserDTO>
    {
        return await this.buildingsUpgradingService.upgradeBuilding(upgradeDTO);
    }
}
