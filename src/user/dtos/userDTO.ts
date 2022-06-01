import { User } from "../models/user.entity";
import { VillageDTO } from "./villageDTO";
import { singleWorkerProductionSpeedPerSecond, factoriesProductionSpeedByLevel } from 'utils';


export class UserDTO
{
    username: string;
    joinDate: Date;
    clanName: string;
    villages: VillageDTO[];

    constructor(user: User)
    {
        this.username = user.username,
        this.joinDate = user.joinDate,
        this.clanName = user.clanName,
        this.villages = user.villages as VillageDTO[]

        for(let village of this.villages)
        {
            village.woodProductionPerSecond =  factoriesProductionSpeedByLevel[village.buildingsLevels.woodFactoryLevel] + village.resourcesWorkers.woodWorkers * singleWorkerProductionSpeedPerSecond ;
            village.stoneProductionPerSecond = factoriesProductionSpeedByLevel[village.buildingsLevels.stoneMineLevel] + village.resourcesWorkers.stoneWorkers * singleWorkerProductionSpeedPerSecond;
            village.cropProductionPerSecond = factoriesProductionSpeedByLevel[village.buildingsLevels.cropFarmLevel] + village.resourcesWorkers.cropWorkers * singleWorkerProductionSpeedPerSecond;
        }
    }
}

