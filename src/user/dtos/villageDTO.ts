import { BuildingsLevels } from "../models/buildingsLevels";
import { Location } from "../models/location";
import { ResourcesAmounts } from "../models/resourcesAmounts";
import { ResourcesWorkers } from "../models/resourcesWorkers";
import { SupportSentEntry } from "../models/supportSent";
import { TroopsAmounts } from "../models/troopsAmounts";
import { Village } from "../models/village.entity";
import { singleWorkerProductionSpeedPerSecond, factoriesProductionSpeedByLevel, VillageTrait, getTraitBonus } from 'utils';

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
    trait?: VillageTrait;

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
        this.trait = village.trait;

        // Calculate base production rates
        let baseWoodProduction = factoriesProductionSpeedByLevel[village.buildingsLevels.woodFactoryLevel] + village.resourcesWorkers.woodWorkers * singleWorkerProductionSpeedPerSecond;
        let baseStoneProduction = factoriesProductionSpeedByLevel[village.buildingsLevels.stoneMineLevel] + village.resourcesWorkers.stoneWorkers * singleWorkerProductionSpeedPerSecond;
        let baseCropProduction = factoriesProductionSpeedByLevel[village.buildingsLevels.cropFarmLevel] + village.resourcesWorkers.cropWorkers * singleWorkerProductionSpeedPerSecond;

        // Apply Vanguard trait bonus if applicable
        if (village.trait === VillageTrait.VANGUARD) {
            const academyLevel = village.buildingsLevels.academyLevel || 1;
            const vanguardBonus = getTraitBonus(academyLevel);
            baseWoodProduction *= (1 + vanguardBonus);
            baseStoneProduction *= (1 + vanguardBonus);
            baseCropProduction *= (1 + vanguardBonus);
        }

        this.woodProductionPerSecond = baseWoodProduction;
        this.stoneProductionPerSecond = baseStoneProduction;
        this.cropProductionPerSecond = baseCropProduction;
    }
}