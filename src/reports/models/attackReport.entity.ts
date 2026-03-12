import { ObjectId } from "mongodb";
import { ResourcesAmounts } from "../../user/models/resourcesAmounts";
import { TroopsAmounts } from "../../user/models/troopsAmounts";
import { IAttackReport } from "./IAttackReport.interface";
import { BossReportType } from "utils";

export class AttackReport implements IAttackReport {
    _id: ObjectId;

    attackerName: string;
    attackerVillageName: string;

    defenderName: string;
    defenderVillageName: string;

    date: Date;
    attackerWon: boolean;
    lootedResources: ResourcesAmounts;

    attackerTotalAttack: number;
    defenderTotalDefence: number; // defenderTotalArmyDefence + defenderTotalSupportArmyDefence + wallDefence
    defenderTotalArmyDefence: number;
    defenderTotalSupportArmyDefence: number;
    wallDefence: number;

    attackerTroops: TroopsAmounts;
    attackerLostTroops: TroopsAmounts;
    defenderTotalTroops: TroopsAmounts;
    defenderTotalLostTroops: TroopsAmounts;
    supportTotalTroops: TroopsAmounts;
    supportTotalLostTroops: TroopsAmounts;

    // Read status per user (attacker and defender see separately)
    readByAttacker: boolean;
    readByDefender: boolean;

    // Report metadata
    reportType: BossReportType;
    bossName?: string;
    bossTier?: string;
    bossHpBefore?: number;
    bossHpAfter?: number;
    bossMaxHp?: number;
    bossDamageDealt?: number;
    bossReward?: ResourcesAmounts;
    bossX?: number;
    bossY?: number;
    bossId?: string;
    attackerVillageX?: number;
    attackerVillageY?: number;
    defenderVillageX?: number;
    defenderVillageY?: number;
    /** Mythic only: relic bound to this boss */
    bossRelicId?: string;
    bossRelicName?: string;

    oasisId?: string;
    oasisName?: string;
    oasisX?: number;
    oasisY?: number;
    oasisResources?: { wood: number; stone: number; crop: number };

    constructor(
        attackerName: string,
        attackerVillageName: string,
        defenderName: string,
        defenderVillageName: string,
        date: Date,
        attackerWon: boolean,
        lootedResources: ResourcesAmounts,
        attackerTotalAttack: number,
        defenderTotalDefence: number,
        defenderTotalArmyDefence: number,
        defenderTotalSupportArmyDefence: number,
        wallDefence: number,
        attackerTroops: TroopsAmounts,
        attackerLostTroops: TroopsAmounts,
        defenderTotalTroops: TroopsAmounts,
        defenderTotalLostTroops: TroopsAmounts,
        supportTotalTroops: TroopsAmounts,
        supportTotalLostTroops: TroopsAmounts,
        reportType: BossReportType = 'pvp',
        bossName?: string,
        bossTier?: string,
        bossHpBefore?: number,
        bossHpAfter?: number,
        bossDamageDealt?: number,
        bossMaxHp?: number,
        bossReward?: ResourcesAmounts,
    ) {
        this.attackerName = attackerName;
        this.attackerVillageName = attackerVillageName;
        this.defenderName = defenderName;
        this.defenderVillageName = defenderVillageName;
        this.date = date;
        this.attackerWon = attackerWon;
        this.lootedResources = lootedResources;
        this.attackerTotalAttack = attackerTotalAttack;
        this.defenderTotalDefence = defenderTotalDefence;
        this.defenderTotalArmyDefence = defenderTotalArmyDefence;
        this.defenderTotalSupportArmyDefence = defenderTotalSupportArmyDefence;
        this.wallDefence = wallDefence;
        this.attackerTroops = attackerTroops;
        this.attackerLostTroops = attackerLostTroops;
        this.defenderTotalTroops = defenderTotalTroops;
        this.defenderTotalLostTroops = defenderTotalLostTroops;
        this.supportTotalTroops = supportTotalTroops;
        this.supportTotalLostTroops = supportTotalLostTroops;
        this.readByAttacker = false;
        this.readByDefender = false;
        this.reportType = reportType;
        this.bossName = bossName;
        this.bossTier = bossTier;
        this.bossHpBefore = bossHpBefore;
        this.bossHpAfter = bossHpAfter;
        this.bossMaxHp = bossMaxHp;
        this.bossDamageDealt = bossDamageDealt;

        if (bossReward) {
            this.bossReward = bossReward;
        }
    }
}

