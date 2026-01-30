import { ObjectId } from "mongodb";
import { TroopsAmounts } from "../../user/models/troopsAmounts";
import { BossTier } from "utils";

export interface IRaidReport {
    _id?: ObjectId;
    
    // Attacker info
    attackerUsername: string;
    attackerVillageName: string;
    attackerClanName: string;
    
    // Boss info
    bossId: string;
    bossName: string;
    bossTier: BossTier;
    bossX: number;
    bossY: number;
    
    // Combat info
    date: Date;
    attackerTroops: TroopsAmounts;
    attackerLostTroops: TroopsAmounts;
    
    // Damage info
    rawDamage: number;           // Damage before distance multiplier
    distanceMultiplier: number;  // e.g., 2.0 for 200%
    actualDamage: number;        // Damage after multiplier
    bossHpBefore: number;
    bossHpAfter: number;
    bossMaxHp: number;
    
    // Distance
    distanceFromVillage: number;
    
    // Read status
    read: boolean;
}

export class RaidReport implements IRaidReport {
    _id?: ObjectId;
    attackerUsername: string;
    attackerVillageName: string;
    attackerClanName: string;
    bossId: string;
    bossName: string;
    bossTier: BossTier;
    bossX: number;
    bossY: number;
    date: Date;
    attackerTroops: TroopsAmounts;
    attackerLostTroops: TroopsAmounts;
    rawDamage: number;
    distanceMultiplier: number;
    actualDamage: number;
    bossHpBefore: number;
    bossHpAfter: number;
    bossMaxHp: number;
    distanceFromVillage: number;
    read: boolean;

    constructor(
        attackerUsername: string,
        attackerVillageName: string,
        attackerClanName: string,
        bossId: string,
        bossName: string,
        bossTier: BossTier,
        bossX: number,
        bossY: number,
        attackerTroops: TroopsAmounts,
        attackerLostTroops: TroopsAmounts,
        rawDamage: number,
        distanceMultiplier: number,
        actualDamage: number,
        bossHpBefore: number,
        bossHpAfter: number,
        bossMaxHp: number,
        distanceFromVillage: number
    ) {
        this.attackerUsername = attackerUsername;
        this.attackerVillageName = attackerVillageName;
        this.attackerClanName = attackerClanName;
        this.bossId = bossId;
        this.bossName = bossName;
        this.bossTier = bossTier;
        this.bossX = bossX;
        this.bossY = bossY;
        this.date = new Date();
        this.attackerTroops = attackerTroops;
        this.attackerLostTroops = attackerLostTroops;
        this.rawDamage = rawDamage;
        this.distanceMultiplier = distanceMultiplier;
        this.actualDamage = actualDamage;
        this.bossHpBefore = bossHpBefore;
        this.bossHpAfter = bossHpAfter;
        this.bossMaxHp = bossMaxHp;
        this.distanceFromVillage = distanceFromVillage;
        this.read = false;
    }
}
