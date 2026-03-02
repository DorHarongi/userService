import { BuildingsLevels } from "./buildingsLevels";
import { Location } from "./location";
import { ResourcesAmounts } from "./resourcesAmounts";
import { ResourcesWorkers } from "./resourcesWorkers";
import { SupportSentEntry } from "./supportSent";
import { TroopsAmounts } from "./troopsAmounts";
import { warehouseStorageByLevel, quartersPopulationByLevel, Skills, EMPTY_SKILLS } from 'utils';

export class Village {
    villageName: string;
    resourcesAmounts: ResourcesAmounts;
    buildingsLevels: BuildingsLevels;
    population: number;
    resourcesWorkers: ResourcesWorkers;
    troops: TroopsAmounts;
    clanTroops: TroopsAmounts;
    location: Location;
    supportSent: SupportSentEntry[];
    skills: Skills;
    aliveSpies: number;
    spyDeathTimestamps: Date[];

    constructor(villageName: string = "New Village", location: Location = new Location(0, 0)) {
        this.villageName = villageName;
        this.location = location;
        this.resourcesAmounts = new ResourcesAmounts(
            warehouseStorageByLevel[1],
            warehouseStorageByLevel[1],
            warehouseStorageByLevel[1],
        );
        this.buildingsLevels = new BuildingsLevels(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
        this.population = quartersPopulationByLevel[1];
        this.resourcesWorkers = new ResourcesWorkers(0, 0, 0);
        this.troops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        this.clanTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        this.supportSent = [];
        this.skills = { ...EMPTY_SKILLS };
        this.aliveSpies = 0;
        this.spyDeathTimestamps = [];
    }
}