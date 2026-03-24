import { BuildingsLevels } from "../models/buildingsLevels";
import { Location } from "../models/location";
import { ResourcesAmounts } from "../models/resourcesAmounts";
import { ResourcesWorkers } from "../models/resourcesWorkers";
import { OasisTroopsSentEntry, SupportSentEntry } from "../models/supportSent";
import { TroopsAmounts } from "../models/troopsAmounts";
import { Village } from "../models/village.entity";
import {
    singleWorkerProductionSpeedPerSecond,
    factoriesProductionSpeedByLevel,
    Skills,
    getSkillBonus,
    SkillCategory,
} from 'utils';

export class VillageDTO {
    villageName: string;
    resourcesAmounts: ResourcesAmounts;
    buildingsLevels: BuildingsLevels;
    population: number;
    resourcesWorkers: ResourcesWorkers;
    troops: TroopsAmounts;
    clanTroops: TroopsAmounts;
    location: Location;
    supportSent: SupportSentEntry[];
    oasisTroopsSent: OasisTroopsSentEntry[];
    woodProductionPerSecond: number;
    stoneProductionPerSecond: number;
    cropProductionPerSecond: number;
    skills: Skills;
    troopsInTransit: number;
    aliveSpies: number;
    spyDeathTimestamps: Date[];

    constructor(village: Village) {
        this.villageName = village.villageName;
        this.resourcesAmounts = village.resourcesAmounts;
        this.buildingsLevels = village.buildingsLevels;
        this.population = village.population;
        this.resourcesWorkers = village.resourcesWorkers;
        this.troops = village.troops;
        this.clanTroops = village.clanTroops;
        this.location = village.location;
        this.supportSent = village.supportSent || [];
        this.oasisTroopsSent = village.oasisTroopsSent || [];
        this.skills = village.skills;
        this.troopsInTransit = village.troopsInTransit || 0;
        this.aliveSpies = village.aliveSpies;
        this.spyDeathTimestamps = village.spyDeathTimestamps || [];

        // Calculate base production rates
        let baseWoodProduction =
            factoriesProductionSpeedByLevel[village.buildingsLevels.woodFactoryLevel] +
            village.resourcesWorkers.woodWorkers * singleWorkerProductionSpeedPerSecond;
        let baseStoneProduction =
            factoriesProductionSpeedByLevel[village.buildingsLevels.stoneMineLevel] +
            village.resourcesWorkers.stoneWorkers * singleWorkerProductionSpeedPerSecond;
        let baseCropProduction =
            factoriesProductionSpeedByLevel[village.buildingsLevels.cropFarmLevel] +
            village.resourcesWorkers.cropWorkers * singleWorkerProductionSpeedPerSecond;

        // Apply Gold Rush skill bonus to production
        const goldRushBonus = getSkillBonus(village.skills, SkillCategory.GOLD_RUSH);
        if (goldRushBonus > 0) {
            const multiplier = 1 + goldRushBonus;
            baseWoodProduction *= multiplier;
            baseStoneProduction *= multiplier;
            baseCropProduction *= multiplier;
        }

        this.woodProductionPerSecond = baseWoodProduction;
        this.stoneProductionPerSecond = baseStoneProduction;
        this.cropProductionPerSecond = baseCropProduction;
    }
}