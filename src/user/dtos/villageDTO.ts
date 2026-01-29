import { BuildingsLevels } from "../models/buildingsLevels";
import { Location } from "../models/location";
import { ResourcesAmounts } from "../models/resourcesAmounts";
import { ResourcesWorkers } from "../models/resourcesWorkers";
import { SupportSentEntry } from "../models/supportSent";
import { TroopsAmounts } from "../models/troopsAmounts";
import { Village } from "../models/village.entity";
import { singleWorkerProductionSpeedPerSecond, factoriesProductionSpeedByLevel } from 'utils';

export class VillageDTO
{
    villageName: string;
    resourcesAmounts: ResourcesAmounts;
    buildingsLevels: BuildingsLevels;
    population: number;
    resourcesWorkers: ResourcesWorkers;
    troops: TroopsAmounts; 
    clanTroops: TroopsAmounts;
    location: Location;
    supportSent: SupportSentEntry[];
    woodProductionPerSecond: number;
    stoneProductionPerSecond:  number;
    cropProductionPerSecond: number;

    constructor(village: Village)
    {
        this.villageName = village.villageName;
        this.resourcesAmounts = village.resourcesAmounts;
        this.buildingsLevels = village.buildingsLevels;
        this.population = village.population;
        this.resourcesWorkers = village.resourcesWorkers;
        this.troops = village.troops;
        this.clanTroops = village.clanTroops;
        this.location = village.location;
        this.supportSent = village.supportSent || [];

        this.woodProductionPerSecond = factoriesProductionSpeedByLevel[village.buildingsLevels.woodFactoryLevel] + village.resourcesWorkers.woodWorkers * singleWorkerProductionSpeedPerSecond ;
        this.stoneProductionPerSecond = factoriesProductionSpeedByLevel[village.buildingsLevels.stoneMineLevel] + village.resourcesWorkers.stoneWorkers * singleWorkerProductionSpeedPerSecond;
        this.cropProductionPerSecond = factoriesProductionSpeedByLevel[village.buildingsLevels.cropFarmLevel] + village.resourcesWorkers.cropWorkers * singleWorkerProductionSpeedPerSecond;
    }
}