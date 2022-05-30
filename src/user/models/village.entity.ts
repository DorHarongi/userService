import { BuildingsLevels } from "./buildingsLevels";
import { ResourcesAmounts } from "./resourcesAmounts";
import { ResourcesWorkers } from "./resourcesWorkers";
import { TroopsAmounts } from "./troopsAmounts";
import { warehouseStorageByLevel, quartersPopulationByLevel } from 'utils';
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
        this.resourcesAmounts = new ResourcesAmounts(warehouseStorageByLevel[1], warehouseStorageByLevel[1], warehouseStorageByLevel[1]);
        this.buildingsLevels = new BuildingsLevels(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
        this.population = quartersPopulationByLevel[1];
        this.resourcesWorkers = new ResourcesWorkers(0, 0 , 0);
        this.troops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        this.clanTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
    }
}