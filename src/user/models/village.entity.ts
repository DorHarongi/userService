import { BuildingsLevels } from "./buildingsLevels";
import { ResourcesAmounts } from "./resourcesAmounts";
import { ResourcesWorkers } from "./resourcesWorkers";
import { TroopsAmounts } from "./troopsAmounts";
export class Village
{
    villageName: string;
    resourcesAmounts: ResourcesAmounts;
    buildingsLevels: BuildingsLevels;
    population: number;
    resourcesWorkers: ResourcesWorkers;
    troops: TroopsAmounts; 
    clanTroops: TroopsAmounts
    constructor()
    {
        this.villageName = "New Village";
        this.resourcesAmounts = new ResourcesAmounts(1000, 1000, 1000);
        this.buildingsLevels = new BuildingsLevels(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
        this.population = 50;
        this.resourcesWorkers = new ResourcesWorkers(0, 0 , 0);
        this.troops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        this.clanTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
    }
}