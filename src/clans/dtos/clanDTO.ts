import { Clan, ClanJoinRequest } from "../models/clan.entity";

export class ClanDTO {
    clanName: string;
    description: string;
    leaderUsername: string;
    members: string[];
    isOpen: boolean;
    pendingRequests: ClanJoinRequest[];
    createdDate: Date;
    totalBossesKilled: number;

    constructor(clan: Clan) {
        this.clanName = clan.clanName;
        this.description = clan.description;
        this.leaderUsername = clan.leaderUsername;
        this.members = clan.members;
        this.isOpen = clan.isOpen;
        this.pendingRequests = clan.pendingRequests;
        this.createdDate = clan.createdDate;
        this.totalBossesKilled = clan.totalBossesKilled || 0;
    }
}

export interface ClanStatisticDTO {
    clanName: string;
    description: string;
    leaderUsername: string;
    memberCount: number;
    totalPopulation: number;
    isOpen: boolean;
    totalBossesKilled: number;
}

export interface ClanMemberRaidStatsDTO {
    username: string;
    weeklyRaidDamage: number;
}

export interface CreateClanDTO {
    clanName: string;
    description: string;
    leaderUsername: string;
    isOpen: boolean;
}

export interface JoinClanRequestDTO {
    clanName: string;
    username: string;
    message?: string;
}

export interface HandleJoinRequestDTO {
    clanName: string;
    leaderUsername: string;
    requestUsername: string;
    accept: boolean;
}

export interface LeaveClanDTO {
    clanName: string;
    username: string;
}

export interface KickMemberDTO {
    clanName: string;
    leaderUsername: string;
    memberUsername: string;
}

export interface UpdateClanNameDTO {
    oldClanName: string;
    newClanName: string;
    leaderUsername: string;
}

export interface ToggleClanOpenDTO {
    clanName: string;
    leaderUsername: string;
    isOpen: boolean;
}
