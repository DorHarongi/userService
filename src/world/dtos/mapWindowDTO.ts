import { BossTier } from 'utils';

export interface MapWindowRequestDTO {
    startX: number;
    startY: number;
}

export interface VillageOnMapDTO {
    x: number;
    y: number;
    ownerUsername: string;
    villageName: string;
    clanName?: string;
}

export interface BossOnMapDTO {
    id: string;
    x: number;
    y: number;
    tier: BossTier;
    name: string;
    currentHp: number;
    maxHp: number;
    claimedByClanId?: string;
    claimedByClanName?: string;
    expiresAt?: Date;
}

export interface MapWindowResponseDTO {
    villages: VillageOnMapDTO[];
    bosses: BossOnMapDTO[];
    worldSize: number;
}

export interface MinimapResponseDTO {
    villages: VillageOnMapDTO[];
    bosses: BossOnMapDTO[];
    worldSize: number;
}
