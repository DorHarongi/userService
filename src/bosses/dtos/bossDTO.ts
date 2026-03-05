import { BossTier, RELIC_NAMES } from "utils";
import { IBoss } from "../models/boss.entity";
import { IRaidReport } from "../models/raidReport.entity";
import { TroopsAmounts } from "../../user/models/troopsAmounts";

export class BossDTO {
    id: string;
    tier: BossTier;
    name: string;
    x: number;
    y: number;
    maxHp: number;
    currentHp: number;
    spawnedAt: Date;
    claimedByClanId?: string;
    claimedByClanName?: string;
    claimedAt?: Date;
    isDefeated: boolean;
    expiresAt?: Date; // When the boss will despawn/expire
    relicId?: string;  // Mythic only: relic bound at spawn
    relicName?: string;

    constructor(boss: IBoss) {
        this.id = boss._id?.toHexString() || '';
        this.tier = boss.tier;
        this.name = boss.name;
        this.x = boss.x;
        this.y = boss.y;
        this.maxHp = boss.maxHp;
        this.currentHp = boss.currentHp;
        this.spawnedAt = boss.spawnedAt;
        this.claimedByClanId = boss.claimedByClanId;
        this.claimedByClanName = boss.claimedByClanName;
        this.claimedAt = boss.claimedAt;
        this.isDefeated = boss.isDefeated;
        this.relicId = boss.relicId;
        if (boss.relicId) {
            const def = RELIC_NAMES.find((r) => r.id === boss.relicId);
            this.relicName = def?.name ?? boss.relicId;
        }
        
        // Mythic bosses never despawn
        if (boss.tier !== BossTier.MYTHIC) {
            if (boss.claimedAt) {
                this.expiresAt = new Date(boss.claimedAt.getTime() + 48 * 60 * 60 * 1000);
            } else {
                this.expiresAt = new Date(boss.spawnedAt.getTime() + 24 * 60 * 60 * 1000);
            }
        }
    }
}

export class AttackBossDTO {
    bossId: string;
    villageName: string;
    troops: TroopsAmounts;
}

export class RaidReportDTO {
    id: string;
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

    constructor(report: IRaidReport) {
        this.id = report._id?.toHexString() || '';
        this.attackerUsername = report.attackerUsername;
        this.attackerVillageName = report.attackerVillageName;
        this.attackerClanName = report.attackerClanName;
        this.bossId = report.bossId;
        this.bossName = report.bossName;
        this.bossTier = report.bossTier;
        this.bossX = report.bossX;
        this.bossY = report.bossY;
        this.date = report.date;
        this.attackerTroops = report.attackerTroops;
        this.attackerLostTroops = report.attackerLostTroops;
        this.rawDamage = report.rawDamage;
        this.distanceMultiplier = report.distanceMultiplier;
        this.actualDamage = report.actualDamage;
        this.bossHpBefore = report.bossHpBefore;
        this.bossHpAfter = report.bossHpAfter;
        this.bossMaxHp = report.bossMaxHp;
        this.distanceFromVillage = report.distanceFromVillage;
        this.read = report.read;
    }
}

export class BossAttackResultDTO {
    report: RaidReportDTO;
    bossDefeated: boolean;
    rewards?: {
        wood: number;
        stone: number;
        crop: number;
    };
}
