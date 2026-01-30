import { Clan, ClanJoinRequest } from "../models/clan.entity";

export class ClanDTO {
    clanName: string;
    description: string;
    leaderUsername: string;
    members: string[];
    isOpen: boolean;
    pendingRequests: ClanJoinRequest[];
    createdDate: Date;

    constructor(clan: Clan) {
        this.clanName = clan.clanName;
        this.description = clan.description;
        this.leaderUsername = clan.leaderUsername;
        this.members = clan.members;
        this.isOpen = clan.isOpen;
        this.pendingRequests = clan.pendingRequests;
        this.createdDate = clan.createdDate;
    }
}

export interface ClanStatisticDTO {
    clanName: string;
    description: string;
    leaderUsername: string;
    memberCount: number;
    totalPopulation: number;
    isOpen: boolean;
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
