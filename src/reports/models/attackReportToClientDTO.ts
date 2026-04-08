import { ResourcesAmounts } from "../../user/models/resourcesAmounts";
import { TroopsAmounts } from "../../user/models/troopsAmounts";
import { AttackReport } from "./attackReport.entity";
import { BossReportType } from "utils";

export class AttackReportToClientDTO {
    id: string;
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

    read: boolean;

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
    bossRelicId?: string;
    bossRelicName?: string;

    oasisId?: string;
    oasisName?: string;
    oasisX?: number;
    oasisY?: number;
    oasisResources?: { wood: number; stone: number; crop: number };

    spySentCount?: number;
    spyCaughtCount?: number;

    defenderResources?: { wood: number; stone: number; crop: number };

    constructor(attackReport: AttackReport, viewingUsername?: string) {
        this.id = attackReport._id?.toString() || '';
        this.attackerName = attackReport.attackerName;
        this.attackerVillageName = attackReport.attackerVillageName;
        this.defenderName = attackReport.defenderName;
        this.defenderVillageName = attackReport.defenderVillageName;
        this.date = attackReport.date;
        this.attackerWon = attackReport.attackerWon;
        this.lootedResources = attackReport.lootedResources;
        this.attackerTotalAttack = attackReport.attackerTotalAttack;
        this.defenderTotalDefence = attackReport.defenderTotalDefence;
        this.defenderTotalArmyDefence = attackReport.defenderTotalArmyDefence;
        this.defenderTotalSupportArmyDefence = attackReport.defenderTotalSupportArmyDefence;
        this.wallDefence = attackReport.wallDefence;
        this.attackerTroops = attackReport.attackerTroops;
        this.attackerLostTroops = attackReport.attackerLostTroops;
        this.defenderTotalTroops = attackReport.defenderTotalTroops;
        this.defenderTotalLostTroops = attackReport.defenderTotalLostTroops;
        this.supportTotalTroops = attackReport.supportTotalTroops;
        this.supportTotalLostTroops = attackReport.supportTotalLostTroops;

        // Determine read status based on viewing user
        // For backward compatibility, treat undefined as read (true)
        if (viewingUsername === attackReport.attackerName) {
            this.read = attackReport.readByAttacker !== false;
        } else if (viewingUsername === attackReport.defenderName) {
            this.read = attackReport.readByDefender !== false;
        } else {
            this.read = true;
        }

        this.reportType = attackReport.reportType;
        this.bossName = attackReport.bossName;
        this.bossTier = attackReport.bossTier;
        this.bossHpBefore = attackReport.bossHpBefore;
        this.bossHpAfter = attackReport.bossHpAfter;
        this.bossMaxHp = attackReport.bossMaxHp;
        this.bossDamageDealt = attackReport.bossDamageDealt;
        this.bossReward = attackReport.bossReward;
        this.bossX = attackReport.bossX;
        this.bossY = attackReport.bossY;
        this.bossId = attackReport.bossId;
        this.attackerVillageX = attackReport.attackerVillageX;
        this.attackerVillageY = attackReport.attackerVillageY;
        this.defenderVillageX = attackReport.defenderVillageX;
        this.defenderVillageY = attackReport.defenderVillageY;
        this.bossRelicId = attackReport.bossRelicId;
        this.bossRelicName = attackReport.bossRelicName;
        this.oasisId = attackReport.oasisId;
        this.oasisName = attackReport.oasisName;
        this.oasisX = attackReport.oasisX;
        this.oasisY = attackReport.oasisY;
        this.oasisResources = attackReport.oasisResources;
        this.spySentCount = attackReport.spySentCount;
        this.spyCaughtCount = attackReport.spyCaughtCount;
        this.defenderResources = attackReport.defenderResources;
    }
}
