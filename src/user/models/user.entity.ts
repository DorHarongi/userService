import { ObjectId } from "mongodb";
import { IUser } from "./IUser.interface";
import { userFromClientDTO } from "../dtos/userFromClientDTO";
import { Village } from "./village.entity";
import { Location } from "./location";
import { maxEnergy, TOTAL_QUESTS } from 'utils'

export interface PendingBossReward {
    rewardId: string; // Unique ID to match with message
    bossName: string;
    defeatedAt: Date;
    rewards: {
        wood: number;
        stone: number;
        crop: number;
    };
}

export class User implements IUser
{
    _id: ObjectId;
    username: string;
    password: string;
    joinDate: Date;
    clanName: string;
    villages: Village[];
    energy: number;
    pendingClanRequests: string[]; // clan names user has requested to join
    intro: string; // player bio/intro, max 200 characters
    currentQuestIndex: number; // 1-15 = on that quest, > TOTAL_QUESTS = completed all (only for first village)
    weeklyRaidDamage: number; // total raid damage done this week (resets every Sunday)
    pendingBossRewards: PendingBossReward[]; // boss rewards waiting to be claimed
    weeklyStats: {
        bossDamage: number;
        resourcesStolen: number;
        successfulDefenses: number;
    };
    totalStats: {
        lifetimeBossDamage: number;
        lifetimeResourcesStolen: number;
        totalBattlesWon: number;
        successfulSpies: number;
        relicsStolen: number;
        resourcesSentToClan: number;
        mythicBossDamage: number;
        supportTroopsSent: number;
        oasesConquered: number;
    };
    selectedTitle?: string;
    unlockedAchievements?: string[];
    theme?: string;
    dailyQuestProgress?: {
        date: string;
        quests: { questId: string; progress: number; claimed: boolean }[];
        pvpWinStreak?: number;
    };
    clanQuestRewardClaimedWeek?: number;
    lastLoginDate?: Date;
    loginCount?: number;

    constructor(userFromClientDTO: userFromClientDTO, initialLocation: Location = new Location(0, 0))
    {
        this.username = userFromClientDTO.username;
        this.password = userFromClientDTO.password;
        this.joinDate = new Date();
        this.clanName = "";
        this.villages = [new Village("New Village", initialLocation)];
        this.energy = maxEnergy;
        this.pendingClanRequests = [];
        this.intro = "";
        this.currentQuestIndex = 1; // Start at quest 1
        this.weeklyRaidDamage = 0;
        this.pendingBossRewards = [];
        this.weeklyStats = {
            bossDamage: 0,
            resourcesStolen: 0,
            successfulDefenses: 0,
        };
        this.totalStats = {
            lifetimeBossDamage: 0,
            lifetimeResourcesStolen: 0,
            totalBattlesWon: 0,
            successfulSpies: 0,
            relicsStolen: 0,
            resourcesSentToClan: 0,
            mythicBossDamage: 0,
            supportTroopsSent: 0,
            oasesConquered: 0,
        };
        this.selectedTitle = undefined;
        this.unlockedAchievements = [];
        this.theme = 'default';
        this.lastLoginDate = new Date();
        this.loginCount = 0;
    }
}