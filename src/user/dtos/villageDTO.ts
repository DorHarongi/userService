import { BuildingsLevels } from "../models/buildingsLevels";
import { ResourcesAmounts } from "../models/resourcesAmounts";
import { ResourcesWorkers } from "../models/resourcesWorkers";
import { TroopsAmounts } from "../models/troopsAmounts";

export class VillageDTO
{
    villageName: string;
    resourcesAmounts: ResourcesAmounts;
    buildingsLevels: BuildingsLevels;
    population: number;
    resourcesWorkers: ResourcesWorkers;
    troops: TroopsAmounts; 
    clanTroops: TroopsAmounts
    woodProductionPerSecond: number;
    stoneProductionPerSecond:  number;
    cropProductionPerSecond: number;
}