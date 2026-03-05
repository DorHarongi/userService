import { ObjectId } from "mongodb";
import { BossTier } from "utils";

export interface IBoss {
    _id?: ObjectId;
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
    defeatedAt?: Date;
    /** Mythic only: relic bound at spawn (not yet taken by any clan) */
    relicId?: string;
}

export class Boss implements IBoss {
    _id?: ObjectId;
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
    defeatedAt?: Date;

    constructor(
        tier: BossTier,
        name: string,
        x: number,
        y: number,
        maxHp: number
    ) {
        this.tier = tier;
        this.name = name;
        this.x = x;
        this.y = y;
        this.maxHp = maxHp;
        this.currentHp = maxHp;
        this.spawnedAt = new Date();
        this.isDefeated = false;
    }
}
