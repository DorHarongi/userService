import { BuildingsLevels } from "./buildingsLevels";
import { ResourcesAmounts } from "./resourcesAmounts";
import { ResourcesWorkers } from "./resourcesWorkers";
import { TroopsAmounts } from "./troopsAmounts";
import { userFromClientDTO } from "./userFromClientDTO";

export class User
{
    username: string;
    password: string; 
    joinDate: Date;
    clanName: string; 
    resourcesAmounts: ResourcesAmounts;
    buildingsLevels: BuildingsLevels;
    population: number;
    resourcesWorkers: ResourcesWorkers;
    troops: TroopsAmounts; 
    clanTroops: TroopsAmounts
    constructor(userFromClientDTO: userFromClientDTO)
    {
        this.username = userFromClientDTO.username;
        this.password = userFromClientDTO.password;
        this.joinDate = new Date();
        this.clanName = "";
        this.resourcesAmounts = new ResourcesAmounts(0, 0, 0);
        this.buildingsLevels = new BuildingsLevels(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
        this.population = 0;
        this.resourcesWorkers = new ResourcesWorkers(0, 0, 0);
        this.troops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        this.clanTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
    }
}